import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './app/App';
import { initStorage } from './db/startup';
import './ui/tokens.css';

void initStorage();

const root = document.getElementById('root');
if (!root) throw new Error('Brak elementu #root');
createRoot(root).render(
  <StrictMode>
    {/* „Ogranicz ruch” w systemie wyłącza animacje transform/layout (zostają zanikania) */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
