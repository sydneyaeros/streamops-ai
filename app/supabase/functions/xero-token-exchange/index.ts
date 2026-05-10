/**
 * xero-token-exchange — Supabase Edge Function
 *
 * Exchanges a Xero OAuth authorisation code for access + refresh tokens,
 * fetches the connected tenant (organisation), and upserts into xero_connections.
 *
 * Called by the React XeroCallback page after the user completes Xero OAuth.
 *
 * Environment variables required (set via `supabase secrets set`):
 *   XERO_CLIENT_ID       — your Xero app client ID
 *   XERO_CLIENT_SECRET   — your Xero app client secret
 *   XERO_REDIRECT_URI    — must match exactly what's registered in Xero developer portal
 *   SUPABASE_URL         — injected automatically
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XERO_TOKEN_URL      = 'https://identity.xero.com/connect/token'
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code, tenantId } = await req.json()

    if (!code || !tenantId) {
      return errorResponse('Missing code or tenantId', 400)
    }

    // ── 1. Exchange code for tokens ──────────────────────────────────────────
    const clientId     = Deno.env.get('XERO_CLIENT_ID')!
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
    const redirectUri  = Deno.env.get('XERO_REDIRECT_URI')!

    const tokenRes = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      console.error('Xero token exchange failed:', body)
      return errorResponse('Xero token exchange failed', 502)
    }

    const tokens = await tokenRes.json()
    const { access_token, refresh_token, expires_in, scope } = tokens

    // expires_in is in seconds
    const tokenExpiry = new Date(Date.now() + expires_in * 1000).toISOString()

    // ── 2. Fetch connected tenant (org) info ─────────────────────────────────
    const connRes = await fetch(XERO_CONNECTIONS_URL, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type':  'application/json',
      },
    })

    if (!connRes.ok) {
      console.error('Failed to fetch Xero connections')
      return errorResponse('Failed to fetch Xero organisation info', 502)
    }

    const connections = await connRes.json()
    if (!connections.length) {
      return errorResponse('No Xero organisation connected', 400)
    }

    // Take the first connected org (most clients have one)
    const { tenantId: xeroTenantId, tenantName: xeroOrgName } = connections[0]

    // ── 3. Upsert into xero_connections ─────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { error: dbError } = await supabase
      .from('xero_connections')
      .upsert({
        tenant_id:      tenantId,
        xero_tenant_id: xeroTenantId,
        xero_org_name:  xeroOrgName,
        access_token,
        refresh_token,
        token_expiry:   tokenExpiry,
        scope,
      }, { onConflict: 'tenant_id' })

    if (dbError) {
      console.error('DB upsert error:', dbError)
      return errorResponse('Failed to save connection', 500)
    }

    // ── 4. Seed subscription row (trial tier) if first time ──────────────────
    await supabase
      .from('subscriptions')
      .upsert({ tenant_id: tenantId, plan: 'trial' }, { onConflict: 'tenant_id', ignoreDuplicates: true })

    return new Response(
      JSON.stringify({ ok: true, orgName: xeroOrgName }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Unexpected error:', err)
    return errorResponse('Internal server error', 500)
  }
})

function errorResponse(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
