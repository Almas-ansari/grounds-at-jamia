import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/index.css';
import './styles/parchment.css';

// Development only, and tree-shaken out of production: lets the signed-in
// screens be reviewed with ?preview=signed-in before a database exists.
if (import.meta.env.DEV) {
  void import('./lib/devPreview').then((m) => m.applyDevPreview());
}

const root = document.getElementById('root');
if (!root) throw new Error('No #root element in the document.');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// The static map is worth having offline; the live prints obviously are not.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
