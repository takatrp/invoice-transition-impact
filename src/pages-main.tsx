import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/app/globals.css';
import { InvoiceImpactSimulator } from '@/src/components/InvoiceImpactSimulator';

const root = document.querySelector('#root');

if (!root) {
  throw new Error('アプリの表示領域が見つかりません。');
}

createRoot(root).render(
  <StrictMode>
    <InvoiceImpactSimulator />
  </StrictMode>,
);
