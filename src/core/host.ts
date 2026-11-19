// When the game is shown inside another page (a portfolio, a games site), it tells that page two things:
// that its first screen is up, and that Esc was pressed on the title screen, where there is nothing to pause or close.
// Played on its own, none of this does anything.
export const insideAnotherPage = window.parent !== window;

export function tellHost(type: 'ready' | 'escape'): void {
  if (insideAnotherPage) window.parent.postMessage({ source: 'dungeon-adventure', type }, '*');
}
