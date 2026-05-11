import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { redirectToXero } from '../lib/xero'
import Layout from '../components/Layout'

export default function Settings() {
  const [searchParams] = useSearchParams()
  const [xero,         setXero]         = useState(null)
  const [user,         setUser]         = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [disconnecting,setDisconnecting]= useState(false)
  const [catalogueCount, setCatalogueCount] = useState(null)
  const [syncing,      setSyncing]      = useState(false)
  const [syncResult,   setSyncResult]   = useState(null)
  const justConnected = searchParams.get('connected') === 'true'

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

      if (user) {
        const { data } = await supabase
          .from('xero_connections')
          .select('*')
          .eq('tenant_id', user.id)
          .maybeSingle()
        setXero(data)

        const { count } = await supabase
          .from('catalogue_cache')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', user.id)
        setCatalogueCount(count ?? 0)
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleSyncCatalogue() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('xero-catalogue-sync', {
        body: { tenant_id: user.id },
      })
      if (error) throw error
      setSyncResult({ ok: true, message: `Synced ${data.synced} items (${data.accounts} accounts, ${data.items} products)` })
      setCatalogueCount(data.synced)
    } catch (err) {
      setSyncResult({ ok: false, message: err.message || 'Sync failed — check Edge Function logs' })
    }
    setSyncing(false)
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Xero? Invoice processing will stop for your organisation.')) return
    setDisconnecting(true)
    await supabase.from('xero_connections').delete().eq('tenant_id', user.id)
    setXero(null)
    setDisconnecting(false)
  }

  if (loading) return <Layout><div style={{ color: 'var(--muted)', fontSize: 14, paddingTop: 40 }}>Loading…</div></Layout>

  return (
    <Layout>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--navy)', letterSpacing: '-0.5px' }}>Settings</h1>
      </div>

      {justConnected && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #86efac',
          borderRadius: 'var(--radius)', padding: '12px 16px',
          marginBottom: 20, fontSize: 14, color: '#15803d', fontWeight: 500
        }}>
          ✓ Xero connected successfully. Invoice processing is now active.
        </div>
      )}

      {/* Xero Connection */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy)', marginBottom: 16 }}>
          Xero connection
        </h2>

        {xero ? (
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px',
              background: '#f0fdf4', border: '1px solid #86efac',
              borderRadius: 'var(--radius)', marginBottom: 16
            }}>
              <span style={{ fontSize: 18 }}>✓</span>
              <div>
                <div style={{ fontWeight: 600, color: '#15803d', fontSize: 14 }}>Connected</div>
                <div style={{ fontSize: 13, color: '#166534' }}>{xero.xero_org_name}</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 16 }}>
              Token expires: {xero.token_expiry ? new Date(xero.token_expiry).toLocaleString('en-AU') : 'Unknown'}
              &nbsp;·&nbsp; Auto-refreshed every 25 minutes
            </div>
            <button
              className="btn btn-danger btn-sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect Xero'}
            </button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 14, color: 'var(--text-light)', marginBottom: 16, lineHeight: 1.6 }}>
              Connect your Xero organisation to enable automatic invoice processing.
              You'll be redirected to Xero to authorise — we never see your Xero password.
            </p>
            <button className="btn btn-primary" onClick={redirectToXero}>
              Connect Xero organisation →
            </button>
          </div>
        )}
      </div>

      {/* Catalogue sync */}
      {xero && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
            Catalogue & account codes
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 16, lineHeight: 1.6 }}>
            Syncs your Xero chart of accounts and Products & Services so Claude can match
            bill line items to the right account codes automatically.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div style={{
              padding: '10px 16px',
              background: catalogueCount > 0 ? '#f0fdf4' : '#fefce8',
              border: `1px solid ${catalogueCount > 0 ? '#86efac' : '#fde047'}`,
              borderRadius: 'var(--radius)', fontSize: 13,
            }}>
              {catalogueCount === null
                ? 'Loading…'
                : catalogueCount > 0
                  ? <span style={{ color: '#15803d', fontWeight: 600 }}>✓ {catalogueCount} items in catalogue</span>
                  : <span style={{ color: '#92400e', fontWeight: 600 }}>⚠ Catalogue is empty — sync required</span>
              }
            </div>
          </div>

          {syncResult && (
            <div style={{
              background: syncResult.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${syncResult.ok ? '#86efac' : '#fecaca'}`,
              borderRadius: 8, padding: '10px 14px',
              fontSize: 13, color: syncResult.ok ? '#15803d' : '#dc2626', marginBottom: 16
            }}>
              {syncResult.ok ? '✓ ' : '✗ '}{syncResult.message}
            </div>
          )}

          <button
            className="btn btn-primary btn-sm"
            onClick={handleSyncCatalogue}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : catalogueCount > 0 ? 'Sync catalogue again' : 'Sync catalogue now →'}
          </button>
        </div>
      )}

      {/* Account */}
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy)', marginBottom: 16 }}>
          Account
        </h2>
        <div style={{ fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-light)' }}>Email</span>
            <span style={{ fontWeight: 500 }}>{user?.email}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12 }}>
            <span style={{ color: 'var(--text-light)' }}>Member since</span>
            <span>{user?.created_at ? new Date(user.created_at).toLocaleDateString('en-AU', { year: 'numeric', month: 'long' }) : '—'}</span>
          </div>
        </div>
      </div>
    </Layout>
  )
}
