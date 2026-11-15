import * as THREE from 'three';

export interface PlayOptions {
  /** Cross-fade time in seconds. */
  fade?: number;
  loop?: boolean;
  speed?: number;
  /** Restart even if this clip is already playing. */
  restart?: boolean;
}

/** Plays named clips on one character with cross-fades. */
export class Animator {
  readonly mixer: THREE.AnimationMixer;
  current = '';
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private active: THREE.AnimationAction | null = null;

  constructor(
    root: THREE.Object3D,
    private readonly clips: Map<string, THREE.AnimationClip>,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  play(name: string, { fade = 0.15, loop = true, speed = 1, restart = false }: PlayOptions = {}): THREE.AnimationAction {
    const action = this.action(name);
    action.timeScale = speed;
    if (this.active === action && !restart) return action;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.reset().setEffectiveWeight(1).play();
    if (this.active && this.active !== action) this.active.crossFadeTo(action, fade, false);
    this.active = action;
    this.current = name;
    return action;
  }

  /** Progress of the current clip, 0..1. */
  get progress(): number {
    const a = this.active;
    return a ? Math.min(1, a.time / a.getClip().duration) : 0;
  }

  duration(name: string): number {
    return this.action(name).getClip().duration;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  private action(name: string): THREE.AnimationAction {
    let action = this.actions.get(name);
    if (!action) {
      const clip = this.clips.get(name);
      if (!clip) throw new Error(`Missing animation: ${name}`);
      action = this.mixer.clipAction(clip);
      this.actions.set(name, action);
    }
    return action;
  }
}
