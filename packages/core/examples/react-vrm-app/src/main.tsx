import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { getAppWindowMode, getWindowTitleForMode } from './windowMode';

document.title = getWindowTitleForMode(getAppWindowMode());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
