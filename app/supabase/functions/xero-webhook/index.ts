/**
 * xero-webhook — Supabase Edge Function
 *
 * Handles two entry points:
 *   1. POST from Xero webhook (trigger = "webhook")
 *      — Validates HMAC-SHA256 signature using the per-connection webhook key
 *      — Processes BILLS CREATE events immediately
 *
 *   2. POST from pg_cron safety net (trigger = "cron")
 *      — No signature required (called internally)
 *      — Scans for bills created in the last 90 min that weren't processed yet
 *
 * Environment variables required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY          — for Claude line-item extraction
 *   XERO_CLIENT_ID             — for re-fetching tokens when needed
 *   XERO_CLIENT_SECRET
 */

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-xero-signature',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const rawBody = await req.text()
    let payload: Record<string, unknown>

    try {
      payload = JSON.parse(rawBody)
    } catch {
      return errorResponse('Invalid JSON', 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Route: cron safety net (internal, no signature required) ─────────────
    if (payload.trigger === 'cron') {
      await handleCron(supabase)
      return okResponse('Cron scan complete')
    }

    // ── HMAC validation for all Xero webhook requests ─────────────────────────
    // Xero sends an intentionally bad signature during "intent to receive"
    // validation — we MUST return 401 for invalid sigs, 200 for valid ones.
    const webhookKey = Deno.env.get('XERO_WEBHOOK_KEY')
    if (webhookKey) {
      const sig = req.headers.get('x-xero-signature')
      if (!sig || !(await verifyHmac(webhookKey, rawBody, sig))) {
        console.log('HMAC validation failed — returning 401')
        return new Response('Unauthorized', { status: 401, headers: corsHeaders })
      }
    }

    // ── Route: Xero webhook ───────────────────────────────────────────────────
    const events = (payload.events as XeroEvent[]) ?? []
    if (!events.length) {
      // Valid signature, empty events — this is the final intent-to-receive confirmation
      return okResponse('No events')
    }

    // Group events by xeroTenantId
    const byTenant = groupByTenant(events)

    for (const [xeroTenantId, tenantEvents] of Object.entries(byTenant)) {
      // Look up tenant config (includes webhook key for signature check)
      const { data: conn } = await supabase
        .from('xero_connections')
        .select('tenant_id, access_token, token_expiry, webhook_key')
        .eq('xero_tenant_id', xeroTenantId)
        .maybeSingle()

      if (!conn) {
        console.warn(`No connection found for xero_tenant_id ${xeroTenantId}`)
        continue
      }

      // Validate HMAC signature if webhook_key is set
      if (conn.webhook_key) {
        const sig = req.headers.get('x-xero-signature')
        if (!sig || !(await verifyHmac(conn.webhook_key, rawBody, sig))) {
          console.error('HMAC verification failed for tenant', xeroTenantId)
          continue
        }
      }

      // Ensure we have a valid access token
      const accessToken = await ensureFreshToken(supabase, conn)
      if (!accessToken) continue

      // Process BILLS CREATE events only
      const billEvents = tenantEvents.filter(
        e => e.eventCategory === 'INVOICE' && e.eventType === 'CREATE' && e.resourceId
      )

      for (const event of billEvents) {
        await processBill({
          supabase,
          tenantId:     conn.tenant_id,
          xeroTenantId,
          billId:       event.resourceId,
          accessToken,
          trigger:      'webhook',
        })
      }
    }

    return okResponse('Processed')

  } catch (err) {
    console.error('Webhook error:', err)
    return errorResponse('Internal server error', 500)
  }
})


// ── Cron handler ─────────────────────────────────────────────────────────────
async function handleCron(supabase: ReturnType<typeof createClient>) {
  // Fetch all active connections
  const { data: connections } = await supabase
    .from('xero_connections')
    .select('tenant_id, xero_tenant_id, access_token, token_expiry')

  if (!connections?.length) return

  const windowStart = new Date(Date.now() - 90 * 60 * 1000).toISOString() // 90 min ago

  for (const conn of connections) {
    const accessToken = await ensureFreshToken(supabase, conn)
    if (!accessToken) continue

    // Fetch bills created in the last 90 minutes from Xero
    const bills = await fetchRecentBills(accessToken, conn.xero_tenant_id, windowStart)

    for (const bill of bills) {
      await processBill({
        supabase,
        tenantId:     conn.tenant_id,
        xeroTenantId: conn.xero_tenant_id,
        billId:       bill.InvoiceID,
        accessToken,
        trigger:      'cron',
      })
    }
  }
}


// ── Bill processor ────────────────────────────────────────────────────────────
interface ProcessBillArgs {
  supabase:     ReturnType<typeof createClient>
  tenantId:     string
  xeroTenantId: string
  billId:       string
  accessToken:  string
  trigger:      'webhook' | 'cron' | 'manual'
}

async function processBill({ supabase, tenantId, xeroTenantId, billId, accessToken, trigger }: ProcessBillArgs) {
  // ── Idempotency guard ──────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('processing_logs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('xero_bill_id', billId)
    .eq('status', 'completed')
    .maybeSingle()

  if (existing) {
    console.log(`Bill ${billId} already processed — skipping`)
    return
  }

  try {
    // ── Fetch bill details from Xero ─────────────────────────────────────────
    const billRes = await fetch(
      `https://api.xero.com/api.xro/2.0/Invoices/${billId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': xeroTenantId,
          'Accept': 'application/json',
        },
      }
    )

    if (!billRes.ok) {
      console.error(`Failed to fetch bill ${billId}:`, await billRes.text())
      await logResult(supabase, { tenantId, billId, trigger, status: 'error', error: 'Failed to fetch bill from Xero' })
      return
    }

    const billData = await billRes.json()
    const invoice  = billData?.Invoices?.[0]

    // Only process ACCPAY (bills/payables), not sales invoices
    if (!invoice || invoice.Type !== 'ACCPAY') return

    const lineItems = invoice.LineItems ?? []

    // ── Fetch tenant's catalogue cache ────────────────────────────────────────
    const { data: catalogue } = await supabase
      .from('catalogue_cache')
      .select('item_code, name, description, account_code')
      .eq('tenant_id', tenantId)
      .eq('is_purchased', true)

    // ── Claude: match line items to catalogue ─────────────────────────────────
    const matchResult = await matchLineItemsWithClaude(lineItems, catalogue ?? [])

    // ── Update Xero bill with matched account codes ───────────────────────────
    const updatedLines = matchResult.lines.map((m: MatchedLine) => ({
      LineItemID:  m.lineItemId,
      AccountCode: m.accountCode,
    }))

    if (updatedLines.length && matchResult.avgConfidence >= 50) {
      await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices/${billId}`,
        {
          method: 'POST',
          headers: {
            'Authorization':  `Bearer ${accessToken}`,
            'Xero-tenant-id': xeroTenantId,
            'Content-Type':   'application/json',
          },
          body: JSON.stringify({ Invoices: [{ InvoiceID: billId, LineItems: updatedLines }] }),
        }
      )
    }

    const status = matchResult.avgConfidence >= 75 ? 'completed' : 'flagged'

    await logResult(supabase, {
      tenantId,
      billId,
      trigger,
      status,
      lineCount:     lineItems.length,
      avgConfidence: matchResult.avgConfidence,
      rawPayload:    matchResult,
    })

  } catch (err) {
    console.error(`Error processing bill ${billId}:`, err)
    await logResult(supabase, { tenantId, billId, trigger, status: 'error', error: String(err) })
  }
}


// ── Claude line-item matching ─────────────────────────────────────────────────
interface MatchedLine { lineItemId: string; accountCode: string; confidence: number }
interface MatchResult { lines: MatchedLine[]; avgConfidence: number }

async function matchLineItemsWithClaude(
  lineItems: Record<string, unknown>[],
  catalogue: Record<string, unknown>[]
): Promise<MatchResult> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!

  const prompt = `You are an accounting assistant. Match each invoice line item to the most appropriate account code from the catalogue below.

CATALOGUE (account codes available):
${JSON.stringify(catalogue, null, 2)}

INVOICE LINE ITEMS:
${JSON.stringify(lineItems, null, 2)}

For each line item, respond with a JSON array of objects:
{
  "lineItemId": "<LineItemID from the invoice>",
  "accountCode": "<AccountCode from catalogue>",
  "confidence": <0-100 integer>
}

If no good match exists (confidence < 50), omit the line item from results.
Respond with ONLY the JSON array, no other text.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    console.error('Claude API error:', await res.text())
    return { lines: [], avgConfidence: 0 }
  }

  const data   = await res.json()
  const text   = data.content?.[0]?.text ?? '[]'
  const lines: MatchedLine[] = JSON.parse(text)
  const avgConfidence = lines.length
    ? Math.round(lines.reduce((s: number, l: MatchedLine) => s + l.confidence, 0) / lines.length)
    : 0

  return { lines, avgConfidence }
}


// ── Token refresh ─────────────────────────────────────────────────────────────
async function ensureFreshToken(
  supabase: ReturnType<typeof createClient>,
  conn: { tenant_id: string; access_token: string; token_expiry: string; refresh_token?: string }
): Promise<string | null> {
  const expiryMs   = new Date(conn.token_expiry).getTime()
  const bufferMs   = 5 * 60 * 1000  // 5-minute buffer
  if (Date.now() + bufferMs < expiryMs) return conn.access_token

  // Token is about to expire — refresh it
  const { data: fullConn } = await supabase
    .from('xero_connections')
    .select('refresh_token')
    .eq('tenant_id', conn.tenant_id)
    .single()

  if (!fullConn?.refresh_token) return null

  const clientId     = Deno.env.get('XERO_CLIENT_ID')!
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: fullConn.refresh_token,
    }),
  })

  if (!res.ok) {
    console.error('Token refresh failed for tenant', conn.tenant_id)
    return null
  }

  const tokens     = await res.json()
  const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await supabase
    .from('xero_connections')
    .update({
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry:  tokenExpiry,
    })
    .eq('tenant_id', conn.tenant_id)

  return tokens.access_token
}


// ── Xero API helpers ──────────────────────────────────────────────────────────
async function fetchRecentBills(accessToken: string, xeroTenantId: string, since: string) {
  const dateStr = since.split('T')[0]
  const url = `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCPAY&ModifiedAfter=${encodeURIComponent(since)}&Statuses=DRAFT,SUBMITTED`

  const res = await fetch(url, {
    headers: {
      'Authorization':  `Bearer ${accessToken}`,
      'Xero-tenant-id': xeroTenantId,
      'Accept':         'application/json',
    },
  })

  if (!res.ok) return []
  const data = await res.json()
  return data.Invoices ?? []
}


// ── Logging helper ────────────────────────────────────────────────────────────
async function logResult(
  supabase: ReturnType<typeof createClient>,
  { tenantId, billId, trigger, status, lineCount, avgConfidence, rawPayload, error }: {
    tenantId:      string
    billId:        string
    trigger:       string
    status:        string
    lineCount?:    number
    avgConfidence?: number
    rawPayload?:   unknown
    error?:        string
  }
) {
  await supabase.from('processing_logs').insert({
    tenant_id:      tenantId,
    xero_bill_id:   billId,
    trigger,
    status,
    line_count:     lineCount ?? null,
    avg_confidence: avgConfidence ?? null,
    raw_payload:    rawPayload ?? null,
    error_message:  error ?? null,
  })
}


// ── HMAC-SHA256 signature verification ───────────────────────────────────────
async function verifyHmac(key: string, body: string, signature: string): Promise<boolean> {
  try {
    const encoder   = new TextEncoder()
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signatureBuffer   = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(body))
    const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    return computedSignature === signature
  } catch (err) {
    console.error('verifyHmac error:', err)
    return false
  }
}


// ── Group webhook events by tenant ────────────────────────────────────────────
interface XeroEvent { eventCategory: string; eventType: string; resourceId: string; tenantId: string }
function groupByTenant(events: XeroEvent[]): Record<string, XeroEvent[]> {
  return events.reduce((acc, ev) => {
    ;(acc[ev.tenantId] ??= []).push(ev)
    return acc
  }, {} as Record<string, XeroEvent[]>)
}


// ── Response helpers ──────────────────────────────────────────────────────────
function okResponse(message: string): Response {
  return new Response(
    JSON.stringify({ ok: true, message }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

function errorResponse(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
