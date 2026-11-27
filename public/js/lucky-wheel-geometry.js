// Pure Lucky Wheel geometry shared by segment rendering and the spin
// animation. Keep this module free of DOM/Firebase so it can be regression
// tested in Node.
//
// The wheel is drawn with a CSS conic-gradient: segment `i` spans
// `[i * step, (i + 1) * step)` degrees clockwise from the top (12 o'clock).
// The stationary pointer sits at the top, so a segment is under the pointer
// when its screen angle is 0 degrees.

const FULL_TURN = 360;

export function segmentStep(total) {
  return Number.isFinite(total) && total > 0 ? FULL_TURN / total : 0;
}

export function segmentCenterAngle(index, total) {
  return (index + 0.5) * segmentStep(total);
}

// Rotation (degrees, clockwise) that brings the centre of `winningIndex`
// under the top pointer, continuing forward from the current rotation.
export function targetRotationForWinner(currentRotation, winningIndex, total, turns = 6) {
  const center = segmentCenterAngle(winningIndex, total);
  const normalized = ((currentRotation % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const offset = ((FULL_TURN - center - normalized) % FULL_TURN + FULL_TURN) % FULL_TURN;
  return currentRotation + FULL_TURN * turns + offset;
}

// Which segment index is under the top pointer for a given wheel rotation.
// Used to prove the announced winner matches the resting pointer position.
export function entryIndexAtPointer(rotation, total) {
  const step = segmentStep(total);
  if (!step) return -1;
  const normalized = ((rotation % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const pointerAngle = ((FULL_TURN - normalized) % FULL_TURN + FULL_TURN) % FULL_TURN;
  const index = Math.floor(pointerAngle / step);
  return Math.min(total - 1, Math.max(0, index));
}

// Label distance from the wheel centre. Keeping this proportional to the
// rendered wheel width keeps labels aligned when presentation mode or the
// viewport changes the wheel size.
export function labelRadiusFor(wheelWidth, ratio = 0.34) {
  return (Number.isFinite(wheelWidth) ? wheelWidth : 0) * ratio;
}
