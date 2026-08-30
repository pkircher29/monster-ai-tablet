import '@fontsource-variable/archivo/wdth.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const rootElement = globalThis.document.getElementById('root');

if (rootElement === null) {
  throw new Error('Monster Agent Hub root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
