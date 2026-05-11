const CLIENT_ID    = '2AFE585BDCF0460AA146925AC0C9FE5E'
const REDIRECT_URI = 'https://app.streamopsai.com.au/auth/xero/callback'

const SCOPES = [
  'openid',
  'profile',
  'email',
  'accounting.transactions',
  'accounting.settings',
  'offline_access'
].join(' ')

/**
 * Generate a random state string for CSRF protection.
 * Stored in sessionStorage and verified in the callback.
 */
export function generateState() {
  const state = crypto.randomUUID()
  sessionStorage.setItem('xero_oauth_state', state)
  return state
}

/**
 * Build the Xero OAuth 2.0 authorisation URL and redirect the browser to it.
 */
export function redirectToXero() {
  const state = generateState()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         SCOPES,
    state
  })
  const url = `https://login.xero.com/identity/connect/authorize?${params}`
  console.log('Xero OAuth URL:', url)
  console.log('Client ID:', JSON.stringify(CLIENT_ID))
  console.log('Redirect URI:', JSON.stringify(REDIRECT_URI))
  window.location.href = url
}

/**
 * Verify the state parameter returned by Xero matches what we stored.
 */
export function verifyState(returnedState) {
  const stored = sessionStorage.getItem('xero_oauth_state')
  sessionStorage.removeItem('xero_oauth_state')
  return stored && stored === returnedState
}
