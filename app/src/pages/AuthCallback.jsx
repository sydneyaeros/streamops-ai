import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate  = useNavigate()
  const [status, setStatus] = useState('Signing you in…')

  useEffect(() => {
    async function handleCallback() {
      // Try exchanging a PKCE code if present in the URL
      const params = new URLSearchParams(window.location.search)
      const code   = params.get('code')

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('Code exchange error:', error)
          setStatus('Sign-in failed — redirecting…')
          setTimeout(() => navigate('/login', { replace: true }), 1500)
          return
        }
      }

      // Check for an existing session (covers hash-based token flow too)
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        navigate('/dashboard', { replace: true })
        return
      }

      // Listen for auth state change as fallback
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) navigate('/dashboard', { replace: true })
      })

      // If nothing fires after 4 seconds, give up
      const timeout = setTimeout(() => {
        subscription.unsubscribe()
        setStatus('Could not sign in — redirecting…')
        setTimeout(() => navigate('/login', { replace: true }), 1000)
      }, 4000)

      return () => {
        subscription.unsubscribe()
        clearTimeout(timeout)
      }
    }

    handleCallback()
  }, [navigate])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--navy) 0%, #0e1e3a 100%)',
      padding: 24
    }}>
      <div className="card" style={{ maxWidth: 360, textAlign: 'center' }}>
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
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>StreamOps AI</h2>
        <p style={{ fontSize: 14, color: 'var(--text-light)' }}>{status}</p>
        <div style={{ marginTop: 20, height: 3, borderRadius: 99, background: 'var(--slate)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 99,
            background: 'linear-gradient(90deg, var(--blue), var(--teal))',
            animation: 'progress 1.5s ease-in-out infinite', width: '60%'
          }} />
        </div>
        <style>{`@keyframes progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }`}</style>
      </div>
    </div>
  )
}
