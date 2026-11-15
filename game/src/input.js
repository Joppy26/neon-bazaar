// Neon Bazaar — input. Keyboard state, mouse look deltas, pointer lock, and
// the buy-menu number keys. One object, read by the player controller and
// the round logic; nothing else touches the DOM events.

export function createInput(canvas) {
  const input = {
    keys: new Set(),
    lookDX: 0,
    lookDY: 0,
    firing: false,
    aiming: false,
    locked: false,
    // Edge-triggered actions, set by the key handler and consumed once per tick.
    pressed: new Set(),
    wheel: 0,
  };

  const KEYMAP = {
    KeyW: 'forward',
    KeyA: 'left',
    KeyS: 'back',
    KeyD: 'right',
    ShiftLeft: 'walk',
    ShiftRight: 'walk',
    ControlLeft: 'crouch',
    ControlRight: 'crouch',
    Space: 'jump',
    KeyR: 'reload',
    KeyB: 'buy',
    KeyQ: 'grenade',
    KeyE: 'use',
    KeyM: 'mute',
    Digit1: 'slot1',
    Digit2: 'slot2',
    Digit3: 'slot3',
    Digit4: 'slot4',
    Digit5: 'slot5',
    Digit6: 'slot6',
    Digit7: 'slot7',
    Escape: 'escape',
  };

  addEventListener('keydown', (e) => {
    const action = KEYMAP[e.code];
    if (!action) return;
    if (e.code === 'Space') e.preventDefault();
    if (!e.repeat) {
      input.keys.add(action);
      input.pressed.add(action);
    }
  });
  addEventListener('keyup', (e) => {
    const action = KEYMAP[e.code];
    if (action) input.keys.delete(action);
  });
  addEventListener('blur', () => {
    input.keys.clear();
    input.firing = false;
    input.aiming = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('wheel', (e) => {
    input.wheel += Math.sign(e.deltaY);
  }, { passive: true });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.lookDX += e.movementX;
    input.lookDY += e.movementY;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      input.firing = false;
      input.aiming = false;
    }
  });

  input.requestLock = () => {
    if (!input.locked) canvas.requestPointerLock();
  };
  /** Read and clear the per-tick deltas. Called once per fixed step. */
  input.consumeLook = () => {
    const dx = input.lookDX;
    const dy = input.lookDY;
    input.lookDX = 0;
    input.lookDY = 0;
    return { dx, dy };
  };
  input.consumePressed = () => {
    const out = input.pressed;
    input.pressed = new Set();
    return out;
  };
  return input;
}
