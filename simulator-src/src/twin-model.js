import {spectralTransmission, displayRgb} from './polarization.js';

/** Conceptual geometry timeline, not an ablation, diffusion or deposition solver. */
function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}
function positive(value, name) {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
function nonnegative(value, name) {
  finite(value, name);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
  return value;
}
export function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value, 'value')));
}
// Timeline is normalized storyboard time. No sputter conformality or CMP rate is solved.
export const PROCESS_MODEL = Object.freeze({
  filmDisplayThicknessOverGlass: .045,
  depositionEnd: .86,
  cmpStart: .90,
  assumptions: [
    'Laser drilling, Cu deposition / prescribed via fill, then top-surface CMP: conceptual sequence only.',
    'Sputtering coats exposed surfaces; complete via filling by sputtering alone is not guaranteed and depends on aspect ratio, coverage and process conditions. Seed deposition and additional electroplating may be required.',
    'Bottom-up via fill is an illustrative volume interpolation, not a sputter transport or deposition-front prediction.',
    'Surface Cu display thickness is 4.5% of glass thickness for visibility, not a process recipe or measured thickness.',
    'CMP removes only top-surface Cu overburden in this idealized view; via Cu remains. No dishing, erosion, selectivity, endpoint or removal-rate calculation.'
  ]
});
export function processState(progress01) {
  const p = clamp01(progress01);
  const phaseId = p === 0 ? 'initial' : p < .18 ? 'strengthening' : p < .62 ? 'drilling' : p < .72 ? 'through' : p < .86 ? 'sputter' : p < .90 ? 'overburden' : p < 1 ? 'cmp' : 'complete';
  const labels = {initial: '초기 유리', strengthening: '이온 강화층 형성', drilling: 'Laser 홀 가공', through: '관통 홀 개방', sputter: 'Cu 스퍼터 · 충전 개념', overburden: 'CMP 전 · 상면 Cu 연속막', cmp: 'CMP · 상면 Cu 제거', complete: 'CMP 완료 · 홀 내부 Cu 유지'};
  const fillFraction = p <= .72 ? 0 : p >= .86 ? 1 : (p - .72) / (.86 - .72);
  const cmpFraction = p <= .90 ? 0 : p >= 1 ? 1 : (p - .90) / (1 - .90);
  return {
    phaseId, phaseLabel: labels[phaseId],
    strengthening: p >= .18 ? 1 : p / .18,
    drillFraction: p <= .18 ? 0 : p >= .62 ? 1 : (p - .18) / (.62 - .18),
    fillFraction,
    depositionFraction: fillFraction,
    cmpFraction,
    surfaceCuFraction: fillFraction * (1 - cmpFraction),
  };
}
/** All geometry is in µm, volume in µm³. A cylindrical bottom-up fill has
 * height = thicknessUm * fillFraction and volume = holeVolumeUm3 * fillFraction.
 * holeVolumeUm3 is per hole; totalHoleVolumeUm3 sums all cylindrical holes.
 * gapUm is the positive edge-to-edge ligament; pitchUm = diameterUm + gapUm.
 * depthUm is the prescribed thickness of each surface strengthening layer.
 */
export function sceneGeometry({thicknessUm, diameterUm, depthUm, gapUm = 120, holeCount = 2, layout = 'row'}) {
  positive(thicknessUm, 'thicknessUm');
  positive(diameterUm, 'diameterUm');
  nonnegative(depthUm, 'depthUm');
  if (depthUm >= thicknessUm / 2) throw new RangeError('depthUm must be < thicknessUm/2');
  positive(gapUm, 'gapUm');
  const pitchUm = positive(diameterUm + gapUm, 'pitchUm');
  if (!Number.isInteger(holeCount) || holeCount < 1 || holeCount > 4) throw new RangeError('holeCount must be an integer from 1 to 4');
  if (layout !== 'row' && layout !== 'grid') throw new RangeError('layout must be row or grid');
  if (layout === 'grid' && holeCount !== 4) throw new RangeError('grid layout requires 4 holes');
  const centersUm = layout === 'grid'
    ? [-pitchUm/2,pitchUm/2].flatMap(y=>[-pitchUm/2,pitchUm/2].map(x=>({x,y})))
    : Array.from({length:holeCount},(_,i)=>({x:(i-(holeCount-1)/2)*pitchUm,y:0}));
  const spanUm = layout === 'grid' ? pitchUm : (holeCount-1)*pitchUm;
  const plateWidthUm = finite(Math.max(6 * diameterUm, 1.4 * thicknessUm, spanUm + 3 * diameterUm), 'plateWidthUm');
  const radiusUm = positive(diameterUm / 2, 'radiusUm');
  const halfThicknessUm = positive(thicknessUm / 2, 'halfThicknessUm');
  const holeVolumeUm3 = positive(Math.PI * radiusUm ** 2 * thicknessUm, 'holeVolumeUm3');
  const totalHoleVolumeUm3 = positive(holeCount * holeVolumeUm3, 'totalHoleVolumeUm3');
  return {thicknessUm, diameterUm, depthUm, gapUm, pitchUm, centersUm, holeCount, layout, totalHoleVolumeUm3, plateWidthUm, halfThicknessUm,
    halfThickness: halfThicknessUm, radiusUm, halfWidthUm: plateWidthUm / 2, holeVolumeUm3};
}
/** Infinite, traction-free circular-hole analytic reference only. This is not
 * the stress solution for blind drilling, copper filling or finite geometry.
 */
export function opticalSample(models, {xOverA, yOverA, loadMPa, coefficient, thicknessUm, wavelengthNm, polarizerAngleDeg, analyzerAngleDeg, spectrumMode = 'mono'}) {
  for (const name of ['kirsch', 'retardanceNm']) {
    if (typeof models?.[name] !== 'function') throw new TypeError(`models.${name} must be a function`);
  }
  finite(xOverA, 'xOverA'); finite(yOverA, 'yOverA');
  nonnegative(loadMPa, 'loadMPa'); finite(coefficient, 'coefficient');
  positive(thicknessUm, 'thicknessUm'); positive(wavelengthNm, 'wavelengthNm');
  finite(polarizerAngleDeg, 'polarizerAngleDeg');
  if (analyzerAngleDeg !== undefined) finite(analyzerAngleDeg, 'analyzerAngleDeg');
  if (!['mono', 'white', 'rgb'].includes(spectrumMode)) throw new RangeError('Unknown spectrumMode');
  const stress = models.kirsch({x: xOverA, y: yOverA, loadMPa});
  if (stress.excluded) return {excluded: true, principalDifferenceMPa: null, retardanceNm: null, phaseRad: null, transmission: null, linearRgb: null};
  const principalDifferenceMPa = nonnegative(stress.principalDifferenceMPa, 'principalDifferenceMPa');
  const retardanceNm = finite(models.retardanceNm({coefficient, stressDifferenceMPa: principalDifferenceMPa, thicknessUm}), 'retardanceNm');
  const phaseRad = finite(2 * Math.PI * (retardanceNm / wavelengthNm), 'phaseRad');
  const fastAxisRad = finite(stress.angleRad, 'angleRad');
  const {transmission, linearRgb} = spectralTransmission({retardanceNm, wavelengthNm, fastAxisRad, polarizerAngleDeg, analyzerAngleDeg, mode: spectrumMode});
  return {excluded: false, principalDifferenceMPa, retardanceNm, phaseRad, transmission: clamp01(transmission), linearRgb};
}

/** Crossed lock follows α through the physically equivalent 180° period. */
export function resolvedAnalyzerAngle(polarizerAngleDeg, analyzerAngleDeg, crossedLocked) {
  finite(polarizerAngleDeg, 'polarizerAngleDeg'); finite(analyzerAngleDeg, 'analyzerAngleDeg');
  return crossedLocked ? ((polarizerAngleDeg + 90) % 180 + 180) % 180 : analyzerAngleDeg;
}

/** Synthetic nondispersive teaching example, not a measured material or fracture prediction. */
export const SINGLE_HOLE_COLOR_EXAMPLE = Object.freeze({
  loadMPa:90, coefficient:6, thicknessUm:1000, wavelengthNm:550,
  polarizerAngleDeg:45, analyzerAngleDeg:135, spectrumMode:'white', displayWhitePoint:1,
});

/** Top-down sRGB RGBA bytes, shared by the 2D canvas and the Three.js texture.
 * Display exposure is deliberately downstream of raw stress, Γ, and I/I₀.
 * Hole pixels are transparent excluded material, not a zero-stress measurement.
 */
export function opticalImageData(models, state, size = 240) {
  if (!Number.isInteger(size) || size < 1 || size > 1024) throw new RangeError('Invalid optical image size');
  const whitePoint = state.displayWhitePoint ?? 1;
  positive(whitePoint, 'displayWhitePoint');
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sample = opticalSample(models, {...state, xOverA:8*((x+.5)/size-.5), yOverA:8*(.5-(y+.5)/size)});
    const k = (y * size + x) * 4;
    if (sample.excluded) continue;
    const rgb = displayRgb(sample.linearRgb, whitePoint);
    for (let channel = 0; channel < 3; channel++) data[k + channel] = Math.round(255 * rgb[channel]);
    data[k + 3] = 255;
  }
  return data;
}
