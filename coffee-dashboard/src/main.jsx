import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)


// PWA Service Worker Registration — with Update Banner Support

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[PWA] Service Worker registered:', registration.scope);

        const dispatchUpdateEvent = (newWorker) => {
          console.log('[PWA] New version available — showing update banner...');
          // Dispatch event so the dashboard can show the update banner
          window.dispatchEvent(
            new CustomEvent('pwa-update-available', { detail: { newWorker } })
          );
        };

        // Case 1: New SW found after page already loaded
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            // New SW installed and waiting — old SW still controlling
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              dispatchUpdateEvent(newWorker);
            }
          });
        });

        // Case 2: SW already waiting when page loaded (e.g. tab was open during deploy)
        if (registration.waiting && navigator.serviceWorker.controller) {
          dispatchUpdateEvent(registration.waiting);
        }

        // When the new SW takes control, reload for fresh version
        // This only fires AFTER user clicks "Refresh" in the banner
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloading) return;
          reloading = true;
          console.log('[PWA] New SW now controlling — reloading page.');
          window.location.reload();
        });

      })
      .catch((error) => {
        console.error('[PWA] Service Worker registration failed:', error);
      });
  });
}