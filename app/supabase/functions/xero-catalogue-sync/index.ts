/**
 * xero-catalogue-sync — Supabase Edge Function
 *
 * Syncs the calling tenant's Xero catalogue into catalogue_cache:
 *   1. Chart of accounts (EXPENSE, DIRECTCOSTS, OVERHEADS types)
 *   2. Products & Services items that have purchase details
 *
 * Called from the Settings page via supabase.functions.invoke().
 *
 * Body: { tenant_id: string }
 *
 * Environment variables required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   XERO_CLIENT_ID
 *   XERO_CLIENT_SECRET
 */

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EXPENSE_TYPES = new Set(['EXPENSE', 'DIRECTCOSTS', 'OVERHEADS', 'CURRLIAB'])

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { tenant_id } = body

    if (!tenant_id) {
      return errorResponse('tenant_id is required', 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Look up Xero connection ───────────────────────────────────────────────
    const { data: conn } = await supabase
      .from('xero_connections')
      .select('xero_tenant_id, access_token, token_expiry, refresh_token')
      .eq('tenant_id', tenant_id)
      .maybeSingle()

    if (!conn) return errorResponse('No Xero connection found for this tenant', 404)

    // ── Ensure fresh access token ─────────────────────────────────────────────
    const accessToken = await ensureFreshToken(supabase, { ...conn, tenant_id })
    if (!accessToken) return errorResponse('Could not obtain a valid Xero access token', 401)

    const xeroHeaders = {
      'Authorization':  `Bearer ${accessToken}`,
      'Xero-tenant-id': conn.xero_tenant_id,
      'Accept':         'application/json',
    }

    // ── Fetch chart of accounts ───────────────────────────────────────────────
    let accountRows: Record<string, unknown>[] = []
    const accountsRes = await fetch(
      'https://api.xero.com/api.xro/2.0/Accounts?where=Status%3D%3D%22ACTIVE%22',
      { headers: xeroHeaders }
    )

    if (accountsRes.ok) {
      const accountsData = await accountsRes.json()
      const accounts: Record<string, unknown>[] = accountsData.Accounts ?? []
      accountRows = accounts
        .filter(a => EXPENSE_TYPES.has(a.Type as string))
        .map(a => ({
          tenant_id,
          item_code:    a.Code,
          name:         a.Name,
          description:  a.Description ?? null,
          account_code: a.Code,
          is_purchased: true,
        }))
      console.log(`Fetched ${accountRows.length} expense accounts from Xero`)
    } else {
      console.warn('Failed to fetch accounts:', await accountsRes.text())
    }

    // ── Fetch Products & Services items ───────────────────────────────────────
    let itemRows: Record<string, unknown>[] = []
    const itemsRes = await fetch(
      'https://api.xero.com/api.xro/2.0/Items',
      { headers: xeroHeaders }
    )

    if (itemsRes.ok) {
      const itemsData = await itemsRes.json()
      const items: Record<string, unknown>[] = itemsData.Items ?? []
      itemRows = items
        .filter(i => {
          const pd = i.PurchaseDetails as Record<string, unknown> | undefined
          return i.IsPurchased && pd?.AccountCode
        })
        .map(i => {
          const pd = i.PurchaseDetails as Record<string, unknown>
          return {
            tenant_id,
            item_code:    i.Code,
            name:         i.Name,
            description:  i.Description ?? null,
            account_code: pd.AccountCode,
            is_purchased: true,
          }
        })
      console.log(`Fetched ${itemRows.length} purchased items from Xero`)
    } else {
      console.warn('Failed to fetch items:', await itemsRes.text())
    }

    const allRows = [...accountRows, ...itemRows]

    // ── Upsert into catalogue_cache ───────────────────────────────────────────
    // Delete existing rows for this tenant then re-insert for a clean sync
    await supabase.from('catalogue_cache').delete().eq('tenant_id', tenant_id)

    if (allRows.length > 0) {
      const { error: insertError } = await supabase.from('catalogue_cache').insert(allRows)
      if (insertError) {
        console.error('Insert error:', insertError)
        return errorResponse('Failed to save catalogue data', 500)
      }
    }

    console.log(`Catalogue sync complete: ${allRows.length} total rows for tenant ${tenant_id}`)

    return new Response(
      JSON.stringify({
        ok:       true,
        synced:   allRows.length,
        accounts: accountRows.length,
        items:    itemRows.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Catalogue sync error:', err)
    return errorResponse('Internal server error', 500)
  }
})


// ── Token refresh (mirrors xero-webhook) ─────────────────────────────────────
async function ensureFreshToken(
  supabase: ReturnType<typeof createClient>,
  conn: { tenant_id: string; access_token: string; token_expiry: string; refresh_token?: string }
): Promise<string | null> {
  const expiryMs = new Date(conn.token_expiry).getTime()
  const bufferMs = 5 * 60 * 1000
  if (Date.now() + bufferMs < expiryMs) return conn.access_token

  // Token expiring — refresh it
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


// ── Response helpers ──────────────────────────────────────────────────────────
function errorResponse(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
