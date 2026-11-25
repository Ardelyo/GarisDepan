import './ui/styles.css';
import { Game } from './game';

declare global {
  interface Window { game?: Game }
}

window.game = new Game();
