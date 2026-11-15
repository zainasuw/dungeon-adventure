import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource-variable/outfit';
import './styles.css';
import { Assets } from './core/assets';
import { Game } from './game';

const loading = document.getElementById('loading')!;
const fill = document.getElementById('loading-fill')!;
const text = document.getElementById('loading-text')!;

async function boot(): Promise<void> {
  const assets = new Assets();
  await assets.load((fraction) => {
    fill.style.transform = `scaleX(${fraction})`;
  });
  const game = new Game(document.getElementById('viewport')!, document.getElementById('ui')!, assets);
  game.start();
  if (import.meta.env.DEV) Object.assign(window, { game });
  loading.classList.add('loading--done');
  loading.addEventListener('transitionend', () => loading.remove(), { once: true });
}

boot().catch((error: unknown) => {
  console.error(error);
  text.textContent = 'The crypt failed to load. Try refreshing, or a browser with WebGL 2.';
  loading.classList.add('loading--error');
});
