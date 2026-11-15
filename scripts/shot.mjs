// Screenshots the running game for visual checks.
//
//   node scripts/shot.mjs <out.png> [url] [--eval "<js run in page>"] [--wait ms]
//
// Uses the GPU through ANGLE/Metal so lighting and post-processing match a real browser.

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const out = args[0] ?? 'shot.png';
const url = args[1] && !args[1].startsWith('--') ? args[1] : 'http://127.0.0.1:5173/';
const evalIndex = args.indexOf('--eval');
const script = evalIndex >= 0 ? args[evalIndex + 1] : null;
const waitIndex = args.indexOf('--wait');
const wait = waitIndex >= 0 ? Number(args[waitIndex + 1]) : 2500;

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => 'game' in window, null, { timeout: 60000 });
if (script) await page.evaluate(script);
await page.waitForTimeout(wait);
const info = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
await page.screenshot({ path: out });
console.log('renderer:', info);
for (const line of logs) console.log(line);
await browser.close();
