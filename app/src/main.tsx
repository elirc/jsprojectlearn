import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.tsx';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// HashRouter rather than BrowserRouter on purpose: `npm run build` should
// produce a dist/ you can open from any static host — or straight off disk —
// without server-side rewrite rules.
createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
