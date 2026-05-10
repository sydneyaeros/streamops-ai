import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { verifyState } from '../lib/xero'

export default function XeroCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Connecting to Xero…')
  const [error,  setError]  = useState(null)

  useEffect(() => {
    async function handleCallback() {
      const params = new URLSearchParams(window.location.search)
      const code   = params.get('code')
      const state  = params.get('state')
      const err    = params.get('error')

      if (err) {
        setError('Xero authorisation was cancelled or denied.')
        return
      }

      if (!code || !state) {
        setError('Invalid callback — missing code or state parameter.')
        return
      }

      if (!verifyState(state)) {
        setError('Security check failed — state mismatch. Please try connecting again.')
        return
      }

      setStatus('Exchanging tokens…')

      // Get the current user's tenant ID
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Not signed in. Please sign in and try again.')
        return
      }

      // Call the Supabase Edge Function to exchange the code for tokens
      const { data, error: fnError } = await supabase.functions.invoke('xero-token-exchange', {
        body: { code, tenantId: user.id }
      })

      if (fnError || data?.error) {
        setError(fnError?.message || data?.error || 'Token exchange failed. Please try again.')
        return
      }

      setStatus('Xero connected successfully! Redirecting…')
      setTimeout(() => navigate('/settings?connected=true'), 1500)
    }

    handleCallback()
  }, [navigate])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--off-white)', padding: 24
    }}>
      <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
        {error ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>Connection failed</h2>
            <p style={{ fontSize: 14, color: 'var(--text-light)', marginBottom: 20 }}>{error}</p>
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>
              Back to settings
            </button>
          </>
        ) : (
          <>
            <div style={{
              width: 44, height: 44, margin: '0 auto 16px',
              background: 'linear-gradient(135deg, var(--blue), var(--teal))',
              borderRadius: 11,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                <path d="M2 6.5H16.5M13.5 3.5L16.5 6.5L13.5 9.5"    stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12H19M16 9L19 12L16 15"                   stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17.5H16.5M13.5 14.5L16.5 17.5L13.5 20.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Connecting Xero</h2>
            <p style={{ fontSize: 14, color: 'var(--text-light)' }}>{status}</p>
            <div style={{
              marginTop: 20, height: 3, borderRadius: 99,
              background: 'var(--slate)', overflow: 'hidden'
            }}>
              <div style={{
                height: '100%', borderRadius: 99,
                background: 'linear-gradient(90deg, var(--blue), var(--teal))',
                animation: 'progress 1.5s ease-in-out infinite',
                width: '60%'
              }} />
            </div>
            <style>{`
              @keyframes progress {
                0%   { transform: translateX(-100%); }
                100% { transform: translateX(250%); }
              }
            `}</style>
          </>
        )}
      </div>
    </div>
  )
}
