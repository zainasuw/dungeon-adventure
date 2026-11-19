import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource-variable/outfit';
import './styles.css';
import { Assets } from './core/assets';
import { Game } from './game';
import { tellHost } from './core/host';

const loading = document.getElementById('loading')!;
const fill = document.getElementById('loading-fill')!;
const text = document.getElementById('loading-text')!;
const tip = document.getElementById('loading-tip')!;

const TIPS = [
  'Tip: hold <b>F</b> to keep swinging.',
  'Tip: a red ring means a skeleton is about to swing. Press <b>Space</b> to dodge!',
  'Tip: follow the glowing gold marker to know where to go.',
  'Tip: click the game, then move the mouse to look around.',
  'Tip: spend your coins at the merchant after each hall.',
  'Tip: press <b>V</b> to switch the camera view.',
  'Tip: press <b>H</b> to drink a potion.',
  'Tip: Easy mode is perfect for kids.',
];
let tipIndex = 0;
const tipTimer = window.setInterval(() => {
  tipIndex = (tipIndex + 1) % TIPS.length;
  tip.style.opacity = '0';
  window.setTimeout(() => {
    tip.innerHTML = TIPS[tipIndex];
    tip.style.opacity = '1';
  }, 300);
}, 2600);

async function boot(): Promise<void> {
  const assets = new Assets();
  await assets.load((fraction) => {
    fill.style.transform = `scaleX(${Math.max(0.02, fraction)})`;
    text.textContent = `Lighting the torches… ${Math.round(fraction * 100)}%`;
  });
  text.textContent = 'Ready!';
  const game = new Game(document.getElementById('viewport')!, document.getElementById('ui')!, assets);
  game.start();
  game.reveal();
  window.clearInterval(tipTimer);
  if (import.meta.env.DEV) Object.assign(window, { game });
  loading.classList.add('loading--done');
  tellHost('ready');
  loading.addEventListener('transitionend', () => loading.remove(), { once: true });
}

boot().catch((error: unknown) => {
  console.error(error);
  text.textContent = 'The crypt failed to load. Try refreshing, or a browser with WebGL 2.';
  loading.classList.add('loading--error');
});
