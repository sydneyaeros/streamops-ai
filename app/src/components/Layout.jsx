import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const NAV_LINKS = [
  { to: '/dashboard',      label: 'Dashboard'  },
  { to: '/invoices',       label: 'Invoices'   },
  { to: '/catalogue',      label: 'Catalogue'  },
  { to: '/settings',       label: 'Settings'   },
]

export default function Layout({ children }) {
  const navigate  = useNavigate()
  const location  = useLocation()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top nav */}
      <nav style={{
        background: 'var(--navy)',
        borderBottom: '1px solid var(--border-dark)',
        padding: '0 24px',
        position: 'sticky', top: 0, zIndex: 100
      }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto',
          display: 'flex', alignItems: 'center',
          height: 60, gap: 32
        }}>
          {/* Logo */}
          <Link to="/dashboard" style={{
            display: 'flex', alignItems: 'center', gap: 9,
            color: 'var(--white)', fontWeight: 700, fontSize: 16,
            letterSpacing: '-0.3px', textDecoration: 'none'
          }}>
            <div style={{
              width: 30, height: 30,
              background: 'linear-gradient(135deg, var(--blue), var(--teal))',
              borderRadius: 7,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M2 6.5H16.5M13.5 3.5L16.5 6.5L13.5 9.5"   stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12H19M16 9L19 12L16 15"                  stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17.5H16.5M13.5 14.5L16.5 17.5L13.5 20.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            StreamOps AI
          </Link>

          {/* Nav links */}
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {NAV_LINKS.map(({ to, label }) => {
              const active = location.pathname.startsWith(to)
              return (
                <Link key={to} to={to} style={{
                  padding: '6px 12px', borderRadius: 6,
                  fontSize: 14, fontWeight: 500,
                  color: active ? 'var(--white)' : 'var(--muted)',
                  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                  textDecoration: 'none', transition: 'all 0.15s'
                }}>
                  {label}
                </Link>
              )
            })}
          </div>

          {/* Sign out */}
          <button onClick={handleSignOut} className="btn btn-sm" style={{
            background: 'rgba(255,255,255,0.08)',
            color: 'var(--muted)', border: '1px solid rgba(255,255,255,0.1)'
          }}>
            Sign out
          </button>
        </div>
      </nav>

      {/* Page content */}
      <main style={{ flex: 1, maxWidth: 1100, margin: '0 auto', width: '100%', padding: '32px 24px' }}>
        {children}
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid var(--border)',
        padding: '16px 24px',
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--muted)'
      }}>
        © 2026 StreamOps AI · <a href="mailto:hello@streamopsai.com.au">hello@streamopsai.com.au</a>
      </footer>
    </div>
  )
}
