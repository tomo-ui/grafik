import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initStorage } from '../db/startup';
import { PcApp } from './PcApp';
import './pc.css';

void initStorage();

const root = document.getElementById('root');
if (!root) throw new Error('Brak elementu #root');
createRoot(root).render(
  <StrictMode>
    <PcApp />
  </StrictMode>,
);
