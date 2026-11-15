import * as THREE from 'three';

/** Keyboard and mouse state, polled once per frame by the game. */
export class Input {
  /** Pointer position in normalized device coordinates. */
  readonly pointer = new THREE.Vector2();
  pointerActive = false;

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

  /** Call at the end of every frame. */
  endFrame(): void {
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
    this.target.focus();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button <= 2) this.buttons[e.button] = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
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
