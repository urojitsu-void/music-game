import { createRoot } from 'react-dom/client';

import { GameApp } from './game-app.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Game root element is missing');
createRoot(root).render(<GameApp />);
