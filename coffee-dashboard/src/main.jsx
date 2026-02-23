import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)


// PWA Service Worker Registration — with Auto-Update Support

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[PWA] Service Worker registered:', registration.scope);

        // Listen for a NEW service worker being installed 
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            // New SW is installed and ready, but old SW is still controlling
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[PWA] New version available — triggering update...');

              // Tell the new SW to skip waiting and take control immediately
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // When the new SW takes control, reload the page 
        // This fires after skipWaiting() activates the new SW
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('[PWA] New SW now controlling — reloading page for fresh version.');
          window.location.reload();
        });

      })
      .catch((error) => {
        console.error('[PWA] Service Worker registration failed:', error);
      });
  });
}