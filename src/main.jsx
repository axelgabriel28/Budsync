import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const App = lazy(() => import('./App.jsx'))
const LandingPage = lazy(() => import('./LandingPage.jsx'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<div className="loading-screen" role="status">Loading Budsync…</div>}>
      {window.location.pathname === '/welcome' ? <LandingPage /> : <App />}
    </Suspense>
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Budsync offline support could not start.', error)
    })
  })
}
