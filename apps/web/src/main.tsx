import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/golos-text';
import './index.css';
import { ApiProvider } from './ApiContext';
import { App } from './App';
import { createApi } from './api';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider api={createApi()}>
      <App />
    </ApiProvider>
  </StrictMode>,
);
