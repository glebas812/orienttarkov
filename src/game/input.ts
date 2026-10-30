/**
 * Keyboard/mouse and touch input. Control conventions are fixed:
 * W/up = forward (+moveZ), S/down = backward, A/left = left, D/right = right.
 * Mouse or touch right = camera right; mouse or touch up = camera up.
 */

import { INPUT_CONFIG } from "./config";
import { getSnapshot } from "./state";

const KEYMAP: Record<string, [axis: "moveX" | "moveZ", dir: 1 | -1]> = {
  KeyW: ["moveZ", 1], ArrowUp: ["moveZ", 1],
  KeyS: ["moveZ", -1], ArrowDown: ["moveZ", -1],
  KeyA: ["moveX", -1], ArrowLeft: ["moveX", -1],
  KeyD: ["moveX", 1], ArrowRight: ["moveX", 1],
};

export class Input {
  moveX = 0;
  moveZ = 0;
  yawDelta = 0;
  pitchDelta = 0;
  readonly actions = new Set<string>();
  primaryDown = false;
  private wheelDelta = 0;
  private held = new Set<string>();
  private virtualMove = { x: 0, z: 0 };
  private secondaryDown = false;
  private touchMoveId: number | null = null;
  private touchAimId: number | null = null;
  private touchMoveOrigin = { x: 0, y: 0 };
  private touchAimOrigin = { x: 0, y: 0 };
  private unsubscribe: Array<() => void> = [];

  constructor(private target: HTMLElement = document.body) {
    const on = <T extends Event>(
      el: Window | Document | HTMLElement,
      type: string,
      fn: (e: T) => void,
      opts?: AddEventListenerOptions,
    ) => {
      const handler = fn as EventListener;
      el.addEventListener(type, handler, opts);
      this.unsubscribe.push(() => el.removeEventListener(type, handler, opts));
    };

    on<KeyboardEvent>(window, "keydown", (e) => {
      if (["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.actions.add(e.code);
      this.recomputeAxes();
    });
    on<KeyboardEvent>(window, "keyup", (e) => {
      this.held.delete(e.code);
      this.recomputeAxes();
    });
    on(window, "blur", () => this.resetAll());
    on(document, "visibilitychange", () => { if (document.hidden) this.resetAll(); });
    on<MouseEvent>(window, "mousemove", (e) => {
      if (document.pointerLockElement || e.buttons > 0) {
        const sensitivity = getSnapshot().mouseSensitivity;
        const sx = INPUT_CONFIG.MOUSE_SENS_X * sensitivity * (INPUT_CONFIG.INVERT_X ? -1 : 1);
        const sy = INPUT_CONFIG.MOUSE_SENS_Y * sensitivity * (INPUT_CONFIG.INVERT_Y ? -1 : 1);
        this.yawDelta -= e.movementX * sx;
        this.pitchDelta += -e.movementY * sy;
      }
    });
    // Mouse events continue to reach the locked canvas in Chromium; secondary
    // pointerdown/pointerup events are not guaranteed while pointer lock is active.
    on<MouseEvent>(target, "mousedown", (e) => {
      if (e.button === 0 && getSnapshot().controlMode === "desktop") this.primaryDown = true;
      if (e.button === 2) {
        this.secondaryDown = true;
        e.preventDefault();
      }
    });
    on<MouseEvent>(window, "mouseup", (e) => {
      // Desktop map raising follows the held left button. Mobile uses the explicit
      // toggle button instead; clearing primaryDown here would undo that tap.
      if (e.button === 0 && getSnapshot().controlMode === "desktop") this.primaryDown = false;
      if (e.button === 2) this.secondaryDown = false;
    });
    on<MouseEvent>(target, "contextmenu", (e) => e.preventDefault());
    on<WheelEvent>(target, "wheel", (e) => { e.preventDefault(); this.wheelDelta += e.deltaY; }, { passive: false });
    // Canvas touches remain a fallback when a finger lands outside the visible controls.
    on<TouchEvent>(target, "touchstart", (e) => this.onTouch(e, true), { passive: false });
    on<TouchEvent>(target, "touchmove", (e) => this.onTouch(e, false), { passive: false });
    on<TouchEvent>(target, "touchend", (e) => this.onTouchEnd(e), { passive: false });
    on<TouchEvent>(target, "touchcancel", (e) => this.onTouchEnd(e), { passive: false });
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.actions.clear();
    this.resetAll();
  }

  /** Direct virtual-control API: React sends discrete pointer events, never per-frame state updates. */
  setVirtualMove(x: number, z: number): void {
    this.virtualMove.x = clamp(x, -1, 1);
    this.virtualMove.z = clamp(z, -1, 1);
    this.recomputeAxes();
  }

  addTouchLook(dx: number, dy: number): void {
    const sensitivity = getSnapshot().touchSensitivity;
    this.yawDelta -= dx * INPUT_CONFIG.MOUSE_SENS_X * 1.65 * sensitivity * (INPUT_CONFIG.INVERT_X ? -1 : 1);
    this.pitchDelta += -dy * INPUT_CONFIG.MOUSE_SENS_Y * 1.65 * sensitivity * (INPUT_CONFIG.INVERT_Y ? -1 : 1);
  }

  setVirtualHeld(code: string, down: boolean): void {
    if (down) this.held.add(code); else this.held.delete(code);
    this.recomputeAxes();
  }

  pressVirtual(code: string): void {
    this.actions.add(code);
  }

  setPrimaryDown(down: boolean): void {
    this.primaryDown = down;
    if (!down) this.secondaryDown = false;
  }

  get compassDragging(): boolean {
    return this.primaryDown && this.secondaryDown;
  }

  private onTouch(e: TouchEvent, start: boolean): void {
    if (getSnapshot().controlMode !== "mobile") return;
    e.preventDefault();
    const w = window.innerWidth;
    for (const t of Array.from(e.changedTouches)) {
      if (start) {
        if (t.clientX < w / 2 && this.touchMoveId === null) {
          this.touchMoveId = t.identifier;
          this.touchMoveOrigin = { x: t.clientX, y: t.clientY };
        } else if (t.clientX >= w / 2 && this.touchAimId === null) {
          this.touchAimId = t.identifier;
          this.touchAimOrigin = { x: t.clientX, y: t.clientY };
        }
      } else if (t.identifier === this.touchMoveId) {
        this.setVirtualMove((t.clientX - this.touchMoveOrigin.x) / 60, -(t.clientY - this.touchMoveOrigin.y) / 60);
      } else if (t.identifier === this.touchAimId) {
        this.addTouchLook(t.clientX - this.touchAimOrigin.x, t.clientY - this.touchAimOrigin.y);
        this.touchAimOrigin = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    if (getSnapshot().controlMode !== "mobile") return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.touchMoveId) {
        this.touchMoveId = null;
        this.setVirtualMove(0, 0);
      } else if (t.identifier === this.touchAimId) {
        this.touchAimId = null;
      }
    }
  }

  private resetAll(): void {
    this.held.clear();
    this.virtualMove = { x: 0, z: 0 };
    this.touchMoveId = null;
    this.touchAimId = null;
    this.secondaryDown = false;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.primaryDown = false;
    this.wheelDelta = 0;
    this.recomputeAxes();
  }

  private recomputeAxes(): void {
    let x = this.virtualMove.x, z = this.virtualMove.z;
    for (const code of this.held) {
      const m = KEYMAP[code];
      if (m) {
        if (m[0] === "moveX") x += m[1]; else z += m[1];
      }
    }
    this.moveX = clamp(x, -1, 1);
    this.moveZ = clamp(z, -1, 1);
  }

  consumeLook(): { yaw: number; pitch: number } {
    const r = { yaw: this.yawDelta, pitch: this.pitchDelta };
    this.yawDelta = 0;
    this.pitchDelta = 0;
    return r;
  }

  isDown(code: string): boolean { return this.held.has(code); }
  clearActions(): void { this.actions.clear(); }

  consumeWheel(): number {
    const delta = this.wheelDelta;
    this.wheelDelta = 0;
    return delta;
  }

  consumeAction(code: string): boolean {
    const has = this.actions.has(code);
    if (has) this.actions.delete(code);
    return has;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
