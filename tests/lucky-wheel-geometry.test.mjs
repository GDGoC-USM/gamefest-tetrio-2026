import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entryIndexAtPointer,
  labelRadiusFor,
  segmentCenterAngle,
  segmentStep,
  targetRotationForWinner
} from '../public/js/lucky-wheel-geometry.js';

const close = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;
const normalize = degrees => ((degrees % 360) + 360) % 360;
const angularDistance = degrees => {
  const normalized = normalize(degrees);
  return Math.min(normalized, 360 - normalized);
};

test('segments cover the full circle in clockwise order', () => {
  for (const total of [1, 2, 3, 7, 12, 24, 40, 150, 317]) {
    const step = segmentStep(total);

    assert.ok(close(step * total, 360));

    for (let index = 0; index < total; index++) {
      const center = segmentCenterAngle(index, total);

      assert.ok(close(center, (index + 0.5) * step));
      assert.ok(center > index * step);
      assert.ok(center < (index + 1) * step);
    }
  }
});

test('the winning segment centre stops under the top pointer from any prior rotation', () => {
  const rotations = [0, 1, 37.5, 359.999, 720, -15, 1234.56, -3600.25];

  for (const total of [1, 2, 3, 7, 12, 24, 40, 150, 317]) {
    const indexes = [...new Set([0, Math.floor(total / 2), total - 1])];

    for (const rotation of rotations) {
      for (const index of indexes) {
        const target = targetRotationForWinner(rotation, index, total, 6);
        const screenAngle = normalize(segmentCenterAngle(index, total) + target);

        assert.ok(
          angularDistance(screenAngle) <= 1e-7,
          `total=${total} index=${index} rotation=${rotation} screen=${screenAngle}`
        );
        assert.equal(entryIndexAtPointer(target, total), index);
      }
    }
  }
});

test('repeated spins over changing pool sizes keep the pointer on the winner', () => {
  let rotation = 0;
  const pools = [1, 2, 5, 5, 13, 3, 40, 151, 7, 2];

  for (let spin = 0; spin < pools.length; spin++) {
    const total = pools[spin];
    const winnerIndex = (spin * 7) % total;
    const previous = rotation;

    rotation = targetRotationForWinner(rotation, winnerIndex, total, 6);

    assert.ok(rotation > previous, 'rotation must always advance');
    assert.ok(rotation - previous >= 360 * 6 - 1e-9);
    assert.ok(rotation - previous < 360 * 7 + 1e-9);
    assert.equal(
      entryIndexAtPointer(rotation, total),
      winnerIndex,
      `spin ${spin}: pool=${total} winner=${winnerIndex}`
    );
  }
});

test('pointer mapping handles full turns and negative rotations', () => {
  const cases = [
    [0, 4, 0],
    [90, 4, 3],
    [180, 4, 2],
    [270, 4, 1],
    [-90, 4, 1],
    [-180, 4, 2],
    [360, 4, 0],
    [720, 4, 0]
  ];

  for (const [rotation, total, expected] of cases) {
    assert.equal(entryIndexAtPointer(rotation, total), expected);
  }
});

test('degenerate pools never resolve to a real entry', () => {
  assert.equal(segmentStep(0), 0);
  assert.equal(segmentStep(-3), 0);
  assert.equal(segmentStep(Number.NaN), 0);
  assert.equal(entryIndexAtPointer(123, 0), -1);
  assert.equal(entryIndexAtPointer(123, -2), -1);
});

test('label radius scales with the rendered wheel and stays inside it', () => {
  for (const width of [300, 402, 560, 1000]) {
    const radius = labelRadiusFor(width);

    assert.ok(close(radius, width * 0.34));
    assert.ok(radius < width / 2);
  }

  assert.equal(labelRadiusFor(undefined), 0);
});
