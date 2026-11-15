import * as THREE from 'three';

/** Which kind of controls the player used last: keyboard and mouse, a touch screen, or a game controller. */
export type InputMode = 'kbm' | 'touch' | 'pad';

/** Keyboard and mouse state, polled once per frame by the game. */
export class Input {
  /** Pointer position in normalized device coordinates. */
  readonly pointer = new THREE.Vector2();
  pointerActive = false;
  /** Sideways mouse movement while the middle button is held, since the last frame. */
  dragX = 0;
  /** Up/down mouse movement while the right or middle button is held. */
  dragY = 0;
  /** Scroll wheel movement since the last frame (positive = toward the player = zoom out). */
  wheel = 0;
  /** Sideways trackpad swipe since the last frame. */
  swipeX = 0;
  /** A right-click that wasn't a drag (released after moving less than a few pixels). */
  rightTap = false;
  private rightTravel = 0;
  private dragTravel = 0;
  /**
   * Touch screens: a floating joystick (it appears wherever the left thumb
   * lands, as in Brawl Stars and Archero). x = right, y = forward, length 0..1.
   */
  readonly stick = new THREE.Vector2();
  /** The controls used last. Prompts and the HUD follow it. */
  mode: InputMode = 'kbm';
  /** True while the player is on touch controls; the HUD shows big thumb buttons. */
  get touchMode(): boolean {
    return this.mode === 'touch';
  }
  /** True while a game controller is being used. */
  get padMode(): boolean {
    return this.mode === 'pad';
  }
  private stickId: number | null = null;
  /** First-person looking since the last frame: mouse (when locked) or a dragging thumb, in pixels. */
  lookDX = 0;
  lookDY = 0;
  /** In first person a click captures the mouse so moving it looks around (like Minecraft). */
  wantsPointerLock = false;
  /** Set when the browser refused the last pointer lock request (e.g. Chrome's pause after Esc). */
  lockRefused = false;
  /** Why the last pointer lock request failed, for diagnosis (the browser's own message). */
  lockError = '';
  /** When the last request was made and how it ended, for diagnosis. */
  readonly lockLog: { at: number; ok: boolean; why: string; active: boolean; focus: boolean }[] = [];
  private lookId: number | null = null;
  private lookTravel = 0;
  /** Right stick of a game controller: turns (x) and tilts (y) the camera. */
  readonly look = new THREE.Vector2();
  private padPrev: boolean[] = [];
  private padStick = false;
  private padRepeat = 0;
  private readonly padCodes = ['KeyF', 'KeyG', 'Space', 'KeyR', 'KeyH', 'Escape'];
  private readonly stickOrigin = new THREE.Vector2();
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private static readonly STICK_RADIUS = 56;

  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly buttons = [false, false, false];
  private readonly buttonsPressed = [false, false, false];

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // Anything that takes the player away forgets every held input: nothing may keep
    // walking or swinging while the window isn't theirs.
    window.addEventListener('blur', this.reset);
    window.addEventListener('pagehide', this.reset);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
    window.addEventListener('gamepaddisconnected', () => this.releasePad());
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
    // A cancelled touch (a system gesture, the palm, an app switch) only cleans up.
    // It is never a tap, so it never attacks.
    window.addEventListener('pointercancel', this.onPointerCancel);
    target.addEventListener('lostpointercapture', this.onPointerCancel);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    // Any touch anywhere (menus too) switches the game to touch controls; a mouse
    // click or a key switches it back.
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setMode('touch');
      else if (e.isTrusted) this.setMode('kbm');
    }, { capture: true });
    document.addEventListener('pointerlockerror', () => {
      this.lockRefused = true;
    });
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'touch-stick';
    this.stickKnob = document.createElement('span');
    this.stickKnob.className = 'touch-stick__knob';
    this.stickBase.append(this.stickKnob);
    document.body.append(this.stickBase);
    target.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Up/down scroll (or pinch) zooms. Sideways trackpad swipes are ignored: they
      // turned the view by accident while playing on a laptop.
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaY) > 4) this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
  }

  key(code: string): boolean {
    return this.down.has(code);
  }

  keyPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** 0 = left, 2 = right. */
  button(index: number): boolean {
    return this.buttons[index];
  }

  buttonPressed(index: number): boolean {
    return this.buttonsPressed[index];
  }

  /** True while a menu or card is open over the game. */
  get menuOpen(): boolean {
    return document.querySelector('.screen-layer--on') !== null;
  }

  /**
   * Captures the mouse for first-person looking. Must be called from a click or
   * key handler (browsers only grant it after a gesture). Resolves true when the
   * lock took; a refusal (Chrome waits 1.25 s after Esc) leaves the "click to look"
   * prompt up, and the next click tries again.
   */
  requestLock(): Promise<boolean> {
    const el = this.target as HTMLElement & { requestPointerLock?: (o?: { unadjustedMovement?: boolean }) => Promise<void> | void };
    if (!el.requestPointerLock || document.pointerLockElement === this.target) return Promise.resolve(document.pointerLockElement === this.target);
    this.lockRefused = false;
    const attempt = (opts?: { unadjustedMovement: boolean }): Promise<void> =>
      new Promise((resolve, reject) => {
        try {
          const r = el.requestPointerLock!(opts);
          if (r && typeof (r as Promise<void>).then === 'function') (r as Promise<void>).then(resolve, reject);
          else resolve();
        } catch (err) {
          reject(err);
        }
      });
    return attempt({ unadjustedMovement: true })
      .catch((err: unknown) => {
        // Older browsers don't know unadjustedMovement: ask again plainly.
        if (err instanceof Error && err.name === 'NotSupportedError') return attempt();
        throw err;
      })
      .then(() => {
        this.lockLog.push({ at: Math.round(performance.now()), ok: true, why: '', active: !!(navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive, focus: document.hasFocus() });
        return true;
      })
      .catch((err: unknown) => {
        this.lockRefused = true;
        this.lockError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        this.lockLog.push({ at: Math.round(performance.now()), ok: false, why: this.lockError, active: !!(navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive, focus: document.hasFocus() });
        return false;
      });
  }

  /**
   * Game controllers (Xbox / PlayStation layout, the browser's standard mapping).
   * In play: left stick walks, right stick turns the camera, A attack, X special,
   * B dodge, Y power, RB or LB potion, Start pause. In menus: the d-pad or stick
   * moves between buttons, A presses, B goes back.
   */
  pollGamepad(menu: boolean, dt: number): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected && p.mapping === 'standard') ?? Array.from(pads).find((p) => p && p.connected);
    if (!pad) {
      if (this.padStick || this.padPrev.some(Boolean)) this.releasePad();
      return;
    }
    const dead = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    const lx = dead(pad.axes[0] ?? 0);
    const ly = dead(pad.axes[1] ?? 0);
    const down = pad.buttons.map((b) => b.pressed);
    const pressedNow = (i: number) => !!down[i] && !this.padPrev[i];
    if (down.some(Boolean) || Math.hypot(lx, ly) > 0.5) this.setMode('pad');

    if (menu) {
      this.look.set(0, 0);
      for (const code of this.padCodes) this.release(code);
      if (this.stickId === null && this.padStick) {
        this.stick.set(0, 0);
        this.padStick = false;
      }
      // Moving between buttons: the d-pad, or the stick with a repeat delay.
      this.padRepeat -= dt;
      let dir = 0;
      if (pressedNow(14) || pressedNow(12)) dir = -1;
      if (pressedNow(15) || pressedNow(13)) dir = 1;
      if (!dir && this.padRepeat <= 0 && Math.abs(lx) > 0.6) dir = Math.sign(lx);
      if (!dir && this.padRepeat <= 0 && Math.abs(ly) > 0.6) dir = Math.sign(ly);
      if (dir) {
        this.padRepeat = 0.28;
        this.menuStep(dir, pressedNow(14) || pressedNow(15) || Math.abs(lx) > 0.6);
      }
      if (pressedNow(0)) {
        const el = document.activeElement;
        if (el instanceof HTMLButtonElement && el.closest('.screen-layer')) el.click();
        else this.tapKey('Enter', 'Enter');
      }
      if (pressedNow(1) || pressedNow(9)) this.tapKey('Escape', 'Escape');
    } else if (this.mode === 'pad') {
      if (this.stickId === null) {
        this.stick.set(lx, -ly);
        this.padStick = true;
      }
      this.look.set(dead(pad.axes[2] ?? 0), dead(pad.axes[3] ?? 0));
      const map: [number, string][] = [[0, 'KeyF'], [2, 'KeyG'], [1, 'Space'], [3, 'KeyR'], [5, 'KeyH'], [4, 'KeyH'], [9, 'Escape']];
      for (const [i, code] of map) {
        if (pressedNow(i)) this.press(code);
        else if (!down[i] && this.padPrev[i]) this.release(code);
      }
    }
    this.padPrev = down;
  }

  /** Lets go of everything a controller was holding (it was unplugged, or the player switched to other controls). */
  private releasePad(): void {
    for (const code of this.padCodes) this.release(code);
    if (this.stickId === null && this.padStick) this.stick.set(0, 0);
    this.padStick = false;
    this.look.set(0, 0);
    this.padPrev = [];
  }

  /** A key press and release for the menus (they listen for keys). */
  private tapKey(key: string, code: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key, code }));
  }

  /** Moves keyboard focus to the next or previous button on the open menu. */
  private menuStep(dir: number, sideways: boolean): void {
    const layer = document.querySelector<HTMLElement>('.screen-layer--on');
    if (!layer) return;
    // The hero lineup and the title use left/right themselves.
    if (sideways && (layer.dataset.screen === 'select')) {
      const k = dir > 0 ? 'ArrowRight' : 'ArrowLeft';
      this.tapKey(k, k);
      return;
    }
    const buttons = Array.from(layer.querySelectorAll<HTMLButtonElement>('button:not([disabled])')).filter((b) => b.offsetParent !== null);
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(at + dir + buttons.length) % buttons.length] ?? buttons[0];
    next.focus();
  }

  /** Holds a key down from an on-screen button (touch controls). */
  press(code: string): void {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  release(code: string): void {
    this.down.delete(code);
  }

  /** Forgets every held key, e.g. when the hero arrives in a new hall or a menu opens. */
  clear(): void {
    this.rightTap = false;
    this.reset();
    this.pressed.clear();
    this.buttonsPressed.fill(false);
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.lookDX = 0;
    this.lookDY = 0;
    this.dragX = 0;
    this.dragY = 0;
    this.wheel = 0;
    this.swipeX = 0;
    this.rightTap = false;
    this.pressed.clear();
    this.buttonsPressed.fill(false);
  }

  private setMode(mode: InputMode): void {
    if (this.mode === mode) return;
    const was = this.mode;
    this.mode = mode;
    if (was === 'pad') this.releasePad();
    if (was === 'touch') this.endStick();
    document.body.classList.toggle('touch-mode', mode === 'touch');
    document.body.classList.toggle('pad-mode', mode === 'pad');
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.isTrusted) this.setMode('kbm');
    // While a menu is open the keyboard belongs to the menu: Tab moves focus, Space
    // and Enter press buttons, arrows pick. Only in play do we stop the browser.
    const onButton = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement;
    if (!this.menuOpen && !onButton && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (this.menuOpen && e.code !== 'Escape') return;
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.setMode('touch');
      // Left half: the joystick appears under the thumb. Right half: tap to attack.
      if (e.clientX < window.innerWidth * 0.5) {
        if (this.stickId === null) {
          this.stickId = e.pointerId;
          this.stickOrigin.set(e.clientX, e.clientY);
          this.stick.set(0, 0);
          this.stickBase.style.left = `${e.clientX}px`;
          this.stickBase.style.top = `${e.clientY}px`;
          this.stickKnob.style.transform = 'translate(-50%, -50%)';
          this.stickBase.classList.add('touch-stick--on');
        }
      } else if (this.lookId === null) {
        // Right side: drag to look around, or a quick tap to attack.
        this.lookId = e.pointerId;
        this.lookTravel = 0;
      }
      return;
    }
    if (e.button === 0 && this.wantsPointerLock && document.pointerLockElement !== this.target) {
      // The first click only captures the mouse; it doesn't swing.
      void this.requestLock();
      return;
    }
    this.updatePointer(e);
    if (e.button > 2) return;
    this.buttons[e.button] = true;
    this.buttonsPressed[e.button] = true;
    if (e.button === 2) this.rightTravel = 0;
    if (e.button === 1 || e.button === 2) this.dragTravel = 0;
    this.target.focus();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.stickId) this.endStick();
      if (e.pointerId === this.lookId) {
        if (this.lookTravel < 12) {
          this.press('KeyF');
          window.setTimeout(() => this.release('KeyF'), 120);
        }
        this.lookId = null;
      }
      return;
    }
    if (e.button === 2 && this.buttons[2] && this.rightTravel < 8) this.rightTap = true;
    if (e.button <= 2) this.buttons[e.button] = false;
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.stickId) this.endStick();
      if (e.pointerId === this.lookId) this.lookId = null;
      return;
    }
    this.buttons.fill(false);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && document.pointerLockElement === this.target) {
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
      return;
    }
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.lookId) {
        this.lookTravel += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (this.lookTravel >= 12) {
          this.lookDX += e.movementX * 1.6;
          this.lookDY += e.movementY * 1.6;
        }
        return;
      }
      if (e.pointerId !== this.stickId) return;
      const r = Input.STICK_RADIUS;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      // The base follows a thumb that slides past the edge, so the stick never "runs out".
      if (len > r) {
        this.stickOrigin.x += (dx / len) * (len - r);
        this.stickOrigin.y += (dy / len) * (len - r);
        dx = (dx / len) * r;
        dy = (dy / len) * r;
        this.stickBase.style.left = `${this.stickOrigin.x}px`;
        this.stickBase.style.top = `${this.stickOrigin.y}px`;
      }
      const dead = 0.15;
      const m = Math.min(1, Math.hypot(dx, dy) / r);
      const k = m < dead ? 0 : (m - dead) / (1 - dead) / Math.max(m, 1e-6);
      this.stick.set((dx / r) * k, (-dy / r) * k);
      this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    if (this.buttons[1] || this.buttons[2]) {
      // Ignore the first few pixels so a click that wobbles doesn't turn the view.
      this.dragTravel += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (this.dragTravel > 10) {
        this.dragX += e.movementX;
        this.dragY += e.movementY;
      }
    }
    if (this.buttons[2]) this.rightTravel += Math.abs(e.movementX) + Math.abs(e.movementY);
    this.updatePointer(e);
  };

  private updatePointer(e: PointerEvent): void {
    const rect = this.target.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerActive = true;
  }

  /** Lets the mouse go again (menus, pausing, switching views). */
  releasePointer(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  private endStick(): void {
    this.stickId = null;
    this.stick.set(0, 0);
    this.stickBase.classList.remove('touch-stick--on');
  }

  private reset = (): void => {
    this.down.clear();
    this.buttons.fill(false);
    this.endStick();
    this.lookId = null;
    this.look.set(0, 0);
    if (this.padStick) {
      this.stick.set(0, 0);
      this.padStick = false;
    }
  };
}
