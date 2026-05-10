import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Login        from './pages/Login'
import Dashboard    from './pages/Dashboard'
import Settings     from './pages/Settings'
import XeroCallback from './pages/XeroCallback'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login"                  element={<Login />} />
        <Route path="/auth/xero/callback"     element={<XeroCallback />} />

        {/* Protected */}
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/settings"  element={<ProtectedRoute><Settings /></ProtectedRoute>} />

        {/* Placeholder routes — to be built */}
        <Route path="/invoices"  element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/catalogue" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

        {/* Default */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
