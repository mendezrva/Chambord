import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/full.css'; // full axes: SOFT for UI, WONK/opsz for the title page
import '@fontsource-variable/nunito';
import App from './App';
import './ui/game.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
