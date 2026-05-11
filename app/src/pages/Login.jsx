import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const navigate = useNavigate()

  // If a session exists or arrives (e.g. from magic link callback), go to dashboard
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/dashboard', { replace: true })
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) navigate('/dashboard', { replace: true })
    })
    return () => subscription.unsubscribe()
  }, [navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'https://app.streamopsai.com.au/auth/callback' }
    })

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--navy) 0%, #0e1e3a 100%)',
      padding: 24
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, margin: '0 auto 12px',
            background: 'linear-gradient(135deg, var(--blue), var(--teal))',
            borderRadius: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
              <path d="M2 6.5H16.5M13.5 3.5L16.5 6.5L13.5 9.5"    stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 12H19M16 9L19 12L16 15"                   stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 17.5H16.5M13.5 14.5L16.5 17.5L13.5 20.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 style={{ color: 'var(--white)', fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px' }}>
            StreamOps AI
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
            Sign in to your account
          </p>
        </div>

        {/* Card */}
        <div className="card">
          {sent ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
              <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Check your email</h2>
              <p style={{ fontSize: 14, color: 'var(--text-light)', lineHeight: 1.6 }}>
                We sent a magic link to <strong>{email}</strong>.<br />
                Click the link to sign in — no password needed.
              </p>
              <button
                onClick={() => { setSent(false); setEmail('') }}
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 20 }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Email address</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {error && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: 8, padding: '10px 14px',
                  fontSize: 13, color: '#dc2626', marginBottom: 16
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-lg"
                style={{ width: '100%' }}
                disabled={loading || !email}
              >
                {loading ? 'Sending…' : 'Send magic link →'}
              </button>
            </form>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#475569' }}>
          Not a client yet?{' '}
          <a href="https://streamopsai.com.au" style={{ color: 'var(--teal-light)' }}>
            Join the waitlist
          </a>
        </p>
      </div>
    </div>
  )
}
