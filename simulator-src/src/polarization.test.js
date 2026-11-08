import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzerTransmission, spectralTransmission, displayRgb, wavelengthRgb,
  WHITE_WAVELENGTHS_NM, RGB_WAVELENGTHS_NM, SPECTRAL_MODEL,
} from './polarization.js';

const close = (actual, expected, tolerance = 2e-12) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected} by more than ${tolerance}`);
const inUnitInterval = value => assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${value} outside [0,1]`);

// Independent complex-amplitude Jones reference, not the implementation's
// convex-combination form, to catch signs and axis/angle convention errors.
function jonesReference({retardanceNm, wavelengthNm, fastAxisRad, polarizerAngleDeg, analyzerAngleDeg}) {
  const a = polarizerAngleDeg * Math.PI / 180 - fastAxisRad;
  const b = analyzerAngleDeg * Math.PI / 180 - fastAxisRad;
  const halfPhase = Math.PI * retardanceNm / wavelengthNm;
  const fast = Math.cos(a) * Math.cos(b);
  const slow = Math.sin(a) * Math.sin(b);
  return ((fast + slow) * Math.cos(halfPhase)) ** 2 + ((fast - slow) * Math.sin(halfPhase)) ** 2;
}

test('arbitrary analyzer orientations match independent complex Jones amplitudes', () => {
  for (const retardanceNm of [0, 1, 137, 275, 550, 1234]) {
    for (const polarizerAngleDeg of [-125, 0, 23, 87, 225]) {
      for (const analyzerAngleDeg of [-34, 0, 63, 90, 131, 300]) {
        const options = {retardanceNm, wavelengthNm: 513, fastAxisRad: 0.371, polarizerAngleDeg, analyzerAngleDeg};
        close(analyzerTransmission(options), jonesReference(options));
      }
    }
  }
});

test('default crossed analyzer reduces to sin²2θ sin²(πΓ/λ)', () => {
  for (const retardanceNm of [0, 1, 137, 275, 550, 825, 1450]) {
    for (const fastAxisRad of [0, 0.17, Math.PI / 4, 1.3]) {
      for (const polarizerAngleDeg of [0, 31, 90, -180]) {
        const expected = Math.sin(2 * (fastAxisRad - polarizerAngleDeg * Math.PI / 180)) ** 2
          * Math.sin(Math.PI * retardanceNm / 550) ** 2;
        const options = {retardanceNm, wavelengthNm: 550, fastAxisRad, polarizerAngleDeg};
        close(analyzerTransmission(options), expected);
        close(analyzerTransmission(options), analyzerTransmission({...options, analyzerAngleDeg: polarizerAngleDeg + 90}));
      }
    }
  }
});

test('zero retardance obeys Malus law and crossed extinction is exact', () => {
  for (const alpha of [-179, 0, 23, 90, 180]) {
    assert.equal(analyzerTransmission({retardanceNm: 0, polarizerAngleDeg: alpha}), 0);
    for (const beta of [-90, 0, 45, 90, 137, 360]) {
      close(analyzerTransmission({retardanceNm: 0, polarizerAngleDeg: alpha, analyzerAngleDeg: beta, fastAxisRad: 1.7}),
        Math.cos((alpha - beta) * Math.PI / 180) ** 2);
    }
  }
  close(analyzerTransmission({retardanceNm: 0, analyzerAngleDeg: 80}), Math.cos(80 * Math.PI / 180) ** 2);
  assert.ok(analyzerTransmission({retardanceNm: 0, analyzerAngleDeg: 80}) > 0);
});

test('orthogonal analyzer outputs conserve intensity, including parallel/crossed complement', () => {
  for (const retardanceNm of [0, 1, 225, 550, 1357]) {
    for (const alpha of [0, 23, 71]) {
      for (const beta of [alpha, 17, 105]) {
        const options = {retardanceNm, wavelengthNm: 550, fastAxisRad: 0.63, polarizerAngleDeg: alpha};
        close(analyzerTransmission({...options, analyzerAngleDeg: beta})
          + analyzerTransmission({...options, analyzerAngleDeg: beta + 90}), 1);
      }
    }
  }
});

test('monochromatic intensity is periodic and invariant under expected symmetries', () => {
  const options = {retardanceNm: 287, wavelengthNm: 531, fastAxisRad: 0.62, polarizerAngleDeg: 17, analyzerAngleDeg: 103};
  const expected = analyzerTransmission(options);
  for (const patch of [
    {retardanceNm: options.retardanceNm + 7 * options.wavelengthNm},
    {retardanceNm: -options.retardanceNm},
    {polarizerAngleDeg: options.polarizerAngleDeg + 180},
    {analyzerAngleDeg: options.analyzerAngleDeg + 180},
    {fastAxisRad: options.fastAxisRad + Math.PI / 2},
    {polarizerAngleDeg: options.polarizerAngleDeg + 36, analyzerAngleDeg: options.analyzerAngleDeg + 36,
      fastAxisRad: options.fastAxisRad + 36 * Math.PI / 180},
  ]) close(analyzerTransmission({...options, ...patch}), expected);
});

test('finite optical inputs remain bounded, even at large phase and angles', () => {
  for (const retardanceNm of [0, Number.MIN_VALUE, -1, 1e20, Number.MAX_VALUE]) {
    for (const wavelengthNm of [Number.MIN_VALUE, 450, 550, 650, Number.MAX_VALUE]) {
      inUnitInterval(analyzerTransmission({retardanceNm, wavelengthNm, fastAxisRad: 1e200,
        polarizerAngleDeg: -1e200, analyzerAngleDeg: 1e200}));
    }
  }
});

test('changing wavelength changes exact intensity and monochromatic display hue', () => {
  const options = {retardanceNm: 275, fastAxisRad: Math.PI / 4};
  const green = spectralTransmission({...options, wavelengthNm: 550});
  const blue = spectralTransmission({...options, wavelengthNm: 450});
  close(green.transmission, 1);
  assert.ok(Math.abs(green.transmission - blue.transmission) > 0.1);
  assert.ok(green.linearRgb[1] > green.linearRgb[2]);
  assert.ok(blue.linearRgb[2] > blue.linearRgb[1]);
  assert.ok(wavelengthRgb(650)[0] > wavelengthRgb(650)[1]);
  assert.deepEqual(wavelengthRgb(900), [0, 0, 0]);
  const invisible = spectralTransmission({...options, wavelengthNm: 900});
  assert.ok(invisible.transmission > 0);
  assert.deepEqual(invisible.linearRgb, [0, 0, 0]);
});

test('flat white and RGB source calibration is neutral, with exact crossed zero', () => {
  for (const mode of ['white', 'rgb']) {
    const dark = spectralTransmission({retardanceNm: 0, mode});
    assert.equal(dark.transmission, 0);
    assert.deepEqual(dark.linearRgb, [0, 0, 0]);
    const white = spectralTransmission({retardanceNm: 0, analyzerAngleDeg: 0, mode});
    close(white.transmission, 1);
    white.linearRgb.forEach(value => close(value, 1));
    const malus = spectralTransmission({retardanceNm: 0, analyzerAngleDeg: 60, mode});
    close(malus.transmission, 0.25);
    malus.linearRgb.forEach(value => close(value, 0.25));
  }
  assert.equal(WHITE_WAVELENGTHS_NM[0], 400);
  assert.equal(WHITE_WAVELENGTHS_NM.at(-1), 700);
  assert.equal(WHITE_WAVELENGTHS_NM.length, 31);
  assert.deepEqual(RGB_WAVELENGTHS_NM, [650, 550, 450]);
  assert.match(SPECTRAL_MODEL.colorimetry, /not CIE/);
});

test('three-band values use their specified wavelengths and mean channel intensity', () => {
  const options = {retardanceNm: 423, fastAxisRad: 0.71, polarizerAngleDeg: 15, analyzerAngleDeg: 108};
  for (const wavelengths of [RGB_WAVELENGTHS_NM, [620, 520, 420]]) {
    const result = spectralTransmission({...options, mode: 'rgb', rgbWavelengthsNm: wavelengths});
    result.linearRgb.forEach((value, index) => close(value,
      analyzerTransmission({...options, wavelengthNm: wavelengths[index]})));
    close(result.transmission, result.linearRgb.reduce((sum, value) => sum + value, 0) / 3);
  }
});

test('white and RGB interference color varies with retardance without a rainbow guarantee', () => {
  for (const mode of ['white', 'rgb']) {
    const first = spectralTransmission({mode, retardanceNm: 275, fastAxisRad: Math.PI / 4});
    const second = spectralTransmission({mode, retardanceNm: 550, fastAxisRad: Math.PI / 4});
    assert.ok(Math.max(...second.linearRgb) - Math.min(...second.linearRgb) > 0.1);
    assert.ok(first.linearRgb.some((value, index) => Math.abs(value - second.linearRgb[index]) > 0.1));
    for (const retardanceNm of [0, 0.01, 130, 400, 1200, 100000]) {
      const result = spectralTransmission({mode, retardanceNm, fastAxisRad: 0.58, polarizerAngleDeg: 17, analyzerAngleDeg: 121});
      inUnitInterval(result.transmission);
      result.linearRgb.forEach(inUnitInterval);
      close(result.transmission, result.linearRgb.reduce((sum, value) => sum + value, 0) / 3);
    }
    // An axis-aligned retarder stays dark under crossed polarizers at any Γ.
    assert.deepEqual(spectralTransmission({mode, retardanceNm: 1937, fastAxisRad: 0}).linearRgb, [0, 0, 0]);
  }
});

test('spectral orthogonal analyzers complement each camera channel', () => {
  for (const mode of ['white', 'rgb']) {
    const options = {mode, retardanceNm: 493, fastAxisRad: 0.73, polarizerAngleDeg: 21};
    const one = spectralTransmission({...options, analyzerAngleDeg: 36});
    const other = spectralTransmission({...options, analyzerAngleDeg: 126});
    one.linearRgb.forEach((value, index) => close(value + other.linearRgb[index], 1));
    close(one.transmission + other.transmission, 1);
  }
});

test('display exposure is applied in linear light before standard sRGB and preserves physical zero', () => {
  for (const whitePoint of [Number.MIN_VALUE, 0.02, 0.15, 1, 2]) {
    assert.deepEqual(displayRgb([0, 0, 0], whitePoint), [0, 0, 0]);
    close(displayRgb([whitePoint, 0, 0], whitePoint)[0], 1);
  }
  close(displayRgb([0.0031308, 0.18, 1])[0], 12.92 * 0.0031308);
  close(displayRgb([0.0031308, 0.18, 1])[1], 0.46135612950044164);
  const raw = [0.005, 0.02, 0.1];
  const before = [...raw];
  const dim = displayRgb(raw, 1);
  const bright = displayRgb(raw, 0.1);
  bright.forEach((value, index) => { inUnitInterval(value); assert.ok(value > dim[index]); });
  assert.deepEqual(raw, before);
  close(displayRgb([0.01, 0.02, 0.03], 0.1)[0], displayRgb([0.1, 0.2, 0.3], 1)[0]);
});

test('invalid optical inputs and invalid display scales are rejected', () => {
  for (const patch of [{retardanceNm: NaN}, {wavelengthNm: 0}, {wavelengthNm: Infinity},
    {fastAxisRad: null}, {fastAxisRad: Infinity}, {polarizerAngleDeg: NaN}, {analyzerAngleDeg: NaN}]) {
    assert.throws(() => analyzerTransmission(patch), RangeError);
  }
  assert.throws(() => spectralTransmission({mode: 'rainbow'}), RangeError);
  for (const rgbWavelengthsNm of [[450], [650, 550, 0], null]) {
    assert.throws(() => spectralTransmission({mode: 'rgb', rgbWavelengthsNm}), RangeError);
  }
  for (const whitePoint of [0, -1, NaN, Infinity]) assert.throws(() => displayRgb([0, 0, 0], whitePoint), RangeError);
  for (const rgb of [null, [0], [0, NaN, 1]]) assert.throws(() => displayRgb(rgb), RangeError);
});
