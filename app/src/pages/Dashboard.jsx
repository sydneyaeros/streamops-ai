import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: accent || 'var(--navy)', letterSpacing: '-1px' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const [stats,      setStats]      = useState(null)
  const [recentLogs, setRecentLogs] = useState([])
  const [xeroStatus, setXeroStatus] = useState(null)
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Check Xero connection
      const { data: xero } = await supabase
        .from('xero_connections')
        .select('xero_org_name, token_expiry')
        .eq('tenant_id', user.id)
        .maybeSingle()
      setXeroStatus(xero)

      // Load processing stats (this month)
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      const { data: logs } = await supabase
        .from('processing_logs')
        .select('*')
        .eq('tenant_id', user.id)
        .gte('created_at', startOfMonth)
        .order('created_at', { ascending: false })

      if (logs) {
        setRecentLogs(logs.slice(0, 8))
        const completed = logs.filter(l => l.status === 'completed')
        const flagged   = logs.filter(l => l.status === 'flagged')
        const avgConf   = completed.length
          ? Math.round(completed.reduce((s, l) => s + (l.avg_confidence || 0), 0) / completed.length)
          : null
        setStats({
          total:    logs.length,
          completed: completed.length,
          flagged:  flagged.length,
          avgConf
        })
      }

      setLoading(false)
    }
    load()
  }, [])

  if (loading) return (
    <Layout>
      <div style={{ color: 'var(--muted)', fontSize: 14, paddingTop: 40 }}>Loading…</div>
    </Layout>
  )

  return (
    <Layout>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--navy)', letterSpacing: '-0.5px' }}>
          Dashboard
        </h1>
        <p style={{ color: 'var(--text-light)', fontSize: 14, marginTop: 4 }}>
          {new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Xero connection banner */}
      {!xeroStatus && (
        <div style={{
          background: 'linear-gradient(135deg, #eff6ff, #ecfeff)',
          border: '1px solid #bfdbfe', borderRadius: 'var(--radius-lg)',
          padding: '18px 22px', marginBottom: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16
        }}>
          <div>
            <div style={{ fontWeight: 700, color: '#1e3a8a', fontSize: 15 }}>
              Connect your Xero organisation
            </div>
            <div style={{ fontSize: 13, color: '#3b82f6', marginTop: 3 }}>
              Link your Xero account to start processing invoices automatically.
            </div>
          </div>
          <Link to="/settings" className="btn btn-primary btn-sm">
            Connect Xero →
          </Link>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        <StatCard
          label="Invoices this month"
          value={stats?.total ?? '—'}
          sub="all statuses"
        />
        <StatCard
          label="Processed"
          value={stats?.completed ?? '—'}
          sub="auto-coded in Xero"
          accent="var(--blue)"
        />
        <StatCard
          label="Flagged for review"
          value={stats?.flagged ?? '—'}
          sub="low confidence"
          accent={stats?.flagged > 0 ? '#d97706' : undefined}
        />
        <StatCard
          label="Avg confidence"
          value={stats?.avgConf != null ? `${stats.avgConf}%` : '—'}
          sub="line item matching"
          accent={stats?.avgConf >= 90 ? '#16a34a' : stats?.avgConf >= 75 ? '#d97706' : '#dc2626'}
        />
      </div>

      {/* Recent activity */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy)' }}>Recent invoices</h2>
          <Link to="/invoices" style={{ fontSize: 13, color: 'var(--blue)' }}>View all →</Link>
        </div>

        {recentLogs.length === 0 ? (
          <div className="empty-state">
            <h3>No invoices processed yet</h3>
            <p>Forward a PDF invoice to your Xero bills address to get started.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Xero bill ID', 'Lines', 'Confidence', 'Trigger', 'Status', 'Date'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'var(--text-light)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentLogs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-light)' }}>
                    {log.xero_bill_id?.slice(0, 8)}…
                  </td>
                  <td style={{ padding: '10px 12px' }}>{log.line_count ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {log.avg_confidence != null
                      ? <span className={`badge ${log.avg_confidence >= 80 ? 'badge-green' : 'badge-amber'}`}>{log.avg_confidence}%</span>
                      : '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span className={`badge ${log.trigger === 'webhook' ? 'badge-blue' : 'badge-gray'}`}>
                      {log.trigger ?? '—'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span className={`badge ${log.status === 'completed' ? 'badge-green' : log.status === 'flagged' ? 'badge-amber' : 'badge-red'}`}>
                      {log.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-light)' }}>
                    {new Date(log.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  )
}
