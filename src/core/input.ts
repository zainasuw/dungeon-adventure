import * as THREE from 'three';

/** Keyboard and mouse state, polled once per frame by the game. */
export class Input {
  /** Pointer position in normalized device coordinates. */
  readonly pointer = new THREE.Vector2();
  pointerActive = false;
  /** Sideways mouse movement while the middle button is held, since the last frame. */
  dragX = 0;
  /** Scroll wheel movement since the last frame (positive = toward the player = zoom out). */
  wheel = 0;
  /** Sideways trackpad swipe since the last frame. */
  swipeX = 0;
  /** A right-click that wasn't a drag (released after moving less than a few pixels). */
  rightTap = false;
  private rightTravel = 0;

  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly buttons = [false, false, false];
  private readonly buttonsPressed = [false, false, false];

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Two-finger sideways swipe turns the view; up/down (or pinch) zooms.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.swipeX += e.deltaX;
      else this.wheel += Math.sign(e.deltaY);
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

  /** Forgets every held key, e.g. when the hero arrives in a new hall. */
  clear(): void {
    this.rightTap = false;
    this.reset();
    this.pressed.clear();
    this.buttonsPressed.fill(false);
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.dragX = 0;
    this.wheel = 0;
    this.swipeX = 0;
    this.rightTap = false;
    this.pressed.clear();
    this.buttonsPressed.fill(false);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.updatePointer(e);
    if (e.button > 2) return;
    this.buttons[e.button] = true;
    this.buttonsPressed[e.button] = true;
    if (e.button === 2) this.rightTravel = 0;
    this.target.focus();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 2 && this.buttons[2] && this.rightTravel < 8) this.rightTap = true;
    if (e.button <= 2) this.buttons[e.button] = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.buttons[1] || this.buttons[2]) this.dragX += e.movementX;
    if (this.buttons[2]) this.rightTravel += Math.abs(e.movementX) + Math.abs(e.movementY);
    this.updatePointer(e);
  };

  private updatePointer(e: PointerEvent): void {
    const rect = this.target.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerActive = true;
  }

  private reset = (): void => {
    this.down.clear();
    this.buttons.fill(false);
  };
}
