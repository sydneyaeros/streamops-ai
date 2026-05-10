/**
 * token-refresh — Supabase Edge Function
 *
 * Refreshes Xero OAuth tokens for all tenants whose token expires
 * within the next 30 minutes. Called every 25 minutes by pg_cron.
 *
 * This is a belt-and-suspenders companion to the inline token refresh
 * inside xero-webhook — it keeps tokens warm even during quiet periods
 * when no invoices are being processed.
 *
 * Environment variables required:
 *   XERO_CLIENT_ID
 *   XERO_CLIENT_SECRET
 *   SUPABASE_URL              — injected automatically
 *   SUPABASE_SERVICE_ROLE_KEY — injected automatically
 */

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Find connections expiring within the next 30 minutes
    const refreshBefore = new Date(Date.now() + 30 * 60 * 1000).toISOString()

    const { data: connections, error } = await supabase
      .from('xero_connections')
      .select('tenant_id, refresh_token, token_expiry')
      .lt('token_expiry', refreshBefore)

    if (error) {
      console.error('Error fetching connections:', error)
      return errorResponse('DB error', 500)
    }

    if (!connections?.length) {
      return okResponse('No tokens need refreshing')
    }

    const clientId     = Deno.env.get('XERO_CLIENT_ID')!
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!

    let refreshed = 0
    let failed    = 0

    for (const conn of connections) {
      try {
        const res = await fetch('https://identity.xero.com/connect/token', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/x-www-form-urlencoded',
            'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          },
          body: new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: conn.refresh_token,
          }),
        })

        if (!res.ok) {
          const body = await res.text()
          console.error(`Token refresh failed for tenant ${conn.tenant_id}:`, body)
          failed++
          continue
        }

        const tokens      = await res.json()
        const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

        const { error: updateError } = await supabase
          .from('xero_connections')
          .update({
            access_token:  tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expiry:  tokenExpiry,
          })
          .eq('tenant_id', conn.tenant_id)

        if (updateError) {
          console.error(`DB update failed for tenant ${conn.tenant_id}:`, updateError)
          failed++
        } else {
          console.log(`Refreshed token for tenant ${conn.tenant_id}, expires ${tokenExpiry}`)
          refreshed++
        }

      } catch (err) {
        console.error(`Unexpected error refreshing tenant ${conn.tenant_id}:`, err)
        failed++
      }
    }

    return okResponse(`Refreshed ${refreshed} token(s), ${failed} failed`)

  } catch (err) {
    console.error('token-refresh error:', err)
    return errorResponse('Internal server error', 500)
  }
})

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
