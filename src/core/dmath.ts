/**
 * Deterministic math for the simulation.
 *
 * IEEE-754 guarantees +, -, *, / and sqrt are correctly rounded, so they give
 * identical results everywhere. Math.sin, Math.cos, Math.atan2, Math.exp and
 * friends do not: engines may differ in the last bits, which would make a
 * replay diverge. The simulation therefore uses these polynomial versions.
 * Accuracy is better than 1e-7, far below anything a battle can notice.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const DEG = PI / 180;

export function dsin(x: number): number {
  x = x - TAU * Math.round(x / TAU);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800))))));
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

export function datan(x: number): number {
  let sign = 1;
  if (x < 0) {
    x = -x;
    sign = -1;
  }
  let inverted = false;
  if (x > 1) {
    x = 1 / x;
    inverted = true;
  }
  let offset = 0;
  // atan(x) = pi/6 + atan((x - 1/sqrt3) / (1 + x/sqrt3)) keeps |x| <= 0.268.
  if (x > 0.2679491924311227) {
    x = (x - 0.5773502691896257) / (1 + 0.5773502691896257 * x);
    offset = PI / 6;
  }
  const x2 = x * x;
  let r = x * (1 + x2 * (-1 / 3 + x2 * (1 / 5 + x2 * (-1 / 7 + x2 * (1 / 9 + x2 * (-1 / 11))))));
  r += offset;
  if (inverted) r = HALF_PI - r;
  return sign * r;
}

export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a - TAU * Math.round(a / TAU);
  if (a <= -PI) a += TAU;
  return a;
}

/** Signed smallest difference b - a, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDiff(from, to);
  if (d > maxStep) return wrapAngle(from + maxStep);
  if (d < -maxStep) return wrapAngle(from - maxStep);
  return to;
}
