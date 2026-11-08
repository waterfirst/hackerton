/** Ideal polarizer → lossless linear retarder → analyzer optics.
 * I0 is the intensity AFTER the first polarizer, not unpolarized source light.
 * Retardance Γ is an optical path difference in nm, constant across wavelength
 * (no material dispersion); phase δ = 2πΓ/λ. No gain or display exposure enters
 * analyzerTransmission or spectralTransmission.
 *
 * Synthetic camera model, NOT CIE colorimetry or a calibrated photograph:
 * - white: flat source from 400–700 nm, trapezoidal integration every 10 nm;
 *   Gaussian R/G/B sensitivities, each normalized to its unobstructed integral.
 * - rgb: equal-power, ideal separately detected R/G/B lines at 650/550/450 nm.
 * - mono: exact scalar intensity, tinted by wavelengthRgb's approximate hue.
 * For white/rgb, scalar transmission is the mean of the three normalized camera
 * channels, not a photopic luminance or an unweighted radiometric integral.
 * White's fixed 10 nm quadrature cannot resolve arbitrarily rapid spectral
 * fringes at very large Γ; neither mode guarantees increasing brightness or a
 * rainbow as Γ increases. Exact extinction remains dark at every exposure.
 */

export const RGB_WAVELENGTHS_NM = Object.freeze([650, 550, 450]);
export const WHITE_WAVELENGTHS_NM = Object.freeze(Array.from({length: 31}, (_, i) => 400 + 10 * i));
export const CAMERA_PEAKS_NM = RGB_WAVELENGTHS_NM;
export const CAMERA_SIGMA_NM = Object.freeze([45, 40, 35]);
export const SPECTRAL_MODEL = Object.freeze({
  whiteRangeNm: Object.freeze([400, 700]),
  whiteStepNm: 10,
  whiteSource: 'flat spectral power; trapezoidal integration',
  rgbWavelengthsNm: RGB_WAVELENGTHS_NM,
  cameraPeaksNm: CAMERA_PEAKS_NM,
  cameraSigmaNm: CAMERA_SIGMA_NM,
  monoVisibleRangeNm: Object.freeze([380, 780]),
  channelNormalization: 'each white camera integral normalized to 1; RGB lines separately detected',
  spectralTransmission: 'mean of normalized R/G/B channel transmissions',
  dispersion: 'none: retardanceNm is the same optical path difference at every wavelength',
  colorimetry: 'illustrative synthetic RGB camera, not CIE',
});

const DEG_TO_RAD = Math.PI / 180;

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function positive(value, name) {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}

function clamp01(value) { return Math.max(0, Math.min(1, value)); }

function cosineSquared(angle) {
  const cosine = Math.cos(angle);
  // Eliminate only trigonometric roundoff at exact extinction orientations.
  return Math.abs(cosine) < 4 * Number.EPSILON ? 0 : cosine * cosine;
}

function angleCoefficients({polarizerAngleDeg = 0, analyzerAngleDeg, fastAxisRad = 0}) {
  const alpha = (finite(polarizerAngleDeg, 'polarizerAngleDeg') % 180) * DEG_TO_RAD;
  const beta = analyzerAngleDeg === undefined
    ? alpha + Math.PI / 2
    : (finite(analyzerAngleDeg, 'analyzerAngleDeg') % 180) * DEG_TO_RAD;
  const phi = finite(fastAxisRad, 'fastAxisRad') % Math.PI;
  // Jones amplitude: cos(α−φ)cos(β−φ)e^(iδ/2) + sin(α−φ)sin(β−φ)e^(−iδ/2).
  // Its squared modulus is A cos²(δ/2) + B sin²(δ/2), a convex combination.
  return [cosineSquared(alpha - beta), cosineSquared(alpha + beta - 2 * phi)];
}

function transmissionAt(retardanceNm, wavelengthNm, a, b) {
  // Reducing phase before multiplication avoids overflow for large finite Γ.
  const sine = Math.sin(Math.PI * ((retardanceNm % wavelengthNm) / wavelengthNm));
  const sineSquared = sine * sine;
  return a * (1 - sineSquared) + b * sineSquared;
}

/** Exact ideal I/I0 for independent polarizer/analyzer angles in degrees.
 * Omitting analyzerAngleDeg means crossed: β = α + 90°. Signed Γ is allowed.
 * Supply fastAxisRad=0 for an undefined axis in a zero-retardance sample.
 */
export function analyzerTransmission({retardanceNm = 0, wavelengthNm = 550, ...angles} = {}) {
  finite(retardanceNm, 'retardanceNm');
  positive(wavelengthNm, 'wavelengthNm');
  const [a, b] = angleCoefficients(angles);
  return transmissionAt(retardanceNm, wavelengthNm, a, b);
}

function cameraResponse(wavelengthNm, channel) {
  const offset = (wavelengthNm - CAMERA_PEAKS_NM[channel]) / CAMERA_SIGMA_NM[channel];
  return Math.exp(-0.5 * offset * offset);
}

// Precomputed once: no Gaussian evaluations or weight normalization per pixel.
const WHITE_WEIGHTS = [0, 1, 2].map(channel => {
  const raw = WHITE_WAVELENGTHS_NM.map((wavelength, index) => cameraResponse(wavelength, channel)
    * (index === 0 || index === WHITE_WAVELENGTHS_NM.length - 1 ? 0.5 : 1));
  const integral = raw.reduce((sum, weight) => sum + weight, 0);
  return raw.map(weight => weight / integral);
});

/** Approximate monochromatic display hue from the synthetic camera curves.
 * Normalized to maximum channel=1 so this tint does not alter the returned
 * physical scalar transmission. Outside the illustrative 380–780 nm visible
 * interval no visible color is shown. This is not a wavelength-to-CIE transform.
 */
export function wavelengthRgb(wavelengthNm) {
  positive(wavelengthNm, 'wavelengthNm');
  if (wavelengthNm < SPECTRAL_MODEL.monoVisibleRangeNm[0]
    || wavelengthNm > SPECTRAL_MODEL.monoVisibleRangeNm[1]) return [0, 0, 0];
  const rgb = [cameraResponse(wavelengthNm, 0), cameraResponse(wavelengthNm, 1), cameraResponse(wavelengthNm, 2)];
  const maximum = Math.max(...rgb);
  return rgb.map(value => value / maximum);
}

/** Linear synthetic camera channels in [0,1], plus scalar transmission.
 * Optional rgbWavelengthsNm is a three-element array in R, G, B order; each
 * wavelength is routed to its named ideal detector. White weights are fixed.
 */
export function spectralTransmission({retardanceNm = 0, wavelengthNm = 550,
  mode = 'mono', rgbWavelengthsNm = RGB_WAVELENGTHS_NM, ...angles} = {}) {
  finite(retardanceNm, 'retardanceNm');
  const [a, b] = angleCoefficients(angles);
  if (mode === 'mono') {
    positive(wavelengthNm, 'wavelengthNm');
    const transmission = transmissionAt(retardanceNm, wavelengthNm, a, b);
    return {transmission, linearRgb: wavelengthRgb(wavelengthNm).map(value => value * transmission)};
  }
  const linearRgb = [0, 0, 0];
  if (mode === 'rgb') {
    if (!Array.isArray(rgbWavelengthsNm) || rgbWavelengthsNm.length !== 3) {
      throw new RangeError('rgbWavelengthsNm must contain three wavelengths in R, G, B order');
    }
    for (let channel = 0; channel < 3; channel++) {
      const wavelength = positive(rgbWavelengthsNm[channel], 'rgbWavelengthsNm');
      linearRgb[channel] = transmissionAt(retardanceNm, wavelength, a, b);
    }
  } else if (mode === 'white') {
    for (let index = 0; index < WHITE_WAVELENGTHS_NM.length; index++) {
      const intensity = transmissionAt(retardanceNm, WHITE_WAVELENGTHS_NM[index], a, b);
      linearRgb[0] += WHITE_WEIGHTS[0][index] * intensity;
      linearRgb[1] += WHITE_WEIGHTS[1][index] * intensity;
      linearRgb[2] += WHITE_WEIGHTS[2][index] * intensity;
    }
    // Only floating-point accumulation can exceed a channel's normalized bound.
    for (let channel = 0; channel < 3; channel++) linearRgb[channel] = clamp01(linearRgb[channel]);
  } else {
    throw new RangeError('mode must be mono, white or rgb');
  }
  return {transmission: (linearRgb[0] + linearRgb[1] + linearRgb[2]) / 3, linearRgb};
}

/** Apply linear exposure 1/whitePoint, then clip and encode standard sRGB.
 * Returns floating-point display channels in [0,1], not 8-bit values. A zero
 * physical channel remains exactly zero at every positive whitePoint.
 */
export function displayRgb(linearRgb, whitePoint = 1) {
  positive(whitePoint, 'whitePoint');
  if (!Array.isArray(linearRgb) || linearRgb.length !== 3) throw new RangeError('linearRgb must contain three channels');
  return linearRgb.map(value => {
    const linear = clamp01(finite(value, 'linearRgb channel') / whitePoint);
    return linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  });
}
