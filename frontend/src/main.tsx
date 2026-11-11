import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { applyTheme, useThemeStore } from './components/ThemeToggle';
import './styles/global.css';

// Apply the persisted theme before first paint; dark is the default.
applyTheme(useThemeStore.getState().theme);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
