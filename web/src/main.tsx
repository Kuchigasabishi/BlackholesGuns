import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SettingsProvider, StoreProvider } from './hooks';
import './index.css';
import { createGameStore } from './net/store';

// Same-origin by default (the server serves this app); VITE_SERVER_URL points a dev build elsewhere.
const store = createGameStore(import.meta.env.VITE_SERVER_URL ? { url: import.meta.env.VITE_SERVER_URL as string } : {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </StoreProvider>
  </StrictMode>,
);
