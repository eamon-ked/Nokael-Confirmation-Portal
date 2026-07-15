import {StrictMode, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerServiceWorker } from './lib/serviceWorker';

// Capture PWA install prompt event early to store on window
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as any).deferredPWAInstallPrompt = e;
  window.dispatchEvent(new CustomEvent('nokael_pwa_prompt_ready'));
  console.log('📥 PWA Install prompt event captured and stored.');
});

// Register service worker for offline support and PWA installability
registerServiceWorker().then((registration) => {
  if (registration) {
    console.log('✅ Offline mode & PWA enabled');
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
