import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(registrations => registrations.forEach(reg => reg.unregister()))
    .catch(() => {})
}

if ('caches' in window) {
  caches.keys()
    .then(keys => Promise.all(keys.map(key => caches.delete(key))))
    .catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
