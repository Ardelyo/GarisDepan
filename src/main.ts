import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './ui/styles.css';
import { Game } from './game';

declare global {
  interface Window { game?: Game }
}

// start loading the faces now so canvas text never falls back (it redraws every frame, so it swaps in when ready)
for (const f of ['500 16px "Barlow Condensed"', '700 16px "Barlow Condensed"', '800 16px "Barlow Condensed"', '400 16px Inter', '600 16px Inter', '700 16px Inter']) {
  void document.fonts?.load(f).catch(() => undefined);
}

window.game = new Game();

// installable + offline after the first visit (production build only)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
