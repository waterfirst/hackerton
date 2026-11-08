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
export function processState(progress01) {
  const p = clamp01(progress01);
  const phaseId = p === 0 ? 'initial' : p < .18 ? 'strengthening' : p < .62 ? 'drilling' : p < .72 ? 'through' : 'fill';
  const labels = {initial: '초기 유리', strengthening: '이온 강화층 형성', drilling: '블라인드 홀 가공', through: '관통 홀 개방', fill: '구리 상향 충전'};
  return {
    phaseId, phaseLabel: labels[phaseId],
    strengthening: p >= .18 ? 1 : p / .18,
    drillFraction: p <= .18 ? 0 : p >= .62 ? 1 : (p - .18) / (.62 - .18),
    fillFraction: p <= .72 ? 0 : p >= 1 ? 1 : (p - .72) / (1 - .72),
  };
}
/** All geometry is in µm, volume in µm³. A cylindrical bottom-up fill has
 * height = thicknessUm * fillFraction and volume = holeVolumeUm3 * fillFraction.
 * depthUm is the prescribed thickness of each surface strengthening layer.
 */
export function sceneGeometry({thicknessUm, diameterUm, depthUm}) {
  positive(thicknessUm, 'thicknessUm');
  positive(diameterUm, 'diameterUm');
  nonnegative(depthUm, 'depthUm');
  if (depthUm >= thicknessUm / 2) throw new RangeError('depthUm must be < thicknessUm/2');
  const plateWidthUm = finite(Math.max(6 * diameterUm, 1.4 * thicknessUm), 'plateWidthUm');
  const radiusUm = positive(diameterUm / 2, 'radiusUm');
  const halfThicknessUm = positive(thicknessUm / 2, 'halfThicknessUm');
  const holeVolumeUm3 = positive(Math.PI * radiusUm ** 2 * thicknessUm, 'holeVolumeUm3');
  return {thicknessUm, diameterUm, depthUm, plateWidthUm, halfThicknessUm,
    halfThickness: halfThicknessUm, radiusUm, halfWidthUm: plateWidthUm / 2, holeVolumeUm3};
}
/** Infinite, traction-free circular-hole analytic reference only. This is not
 * the stress solution for blind drilling, copper filling or finite geometry.
 */
export function opticalSample(models, {xOverA, yOverA, loadMPa, coefficient, thicknessUm, wavelengthNm, polarizerAngleDeg}) {
  for (const name of ['kirsch', 'retardanceNm', 'crossedTransmission']) {
    if (typeof models?.[name] !== 'function') throw new TypeError(`models.${name} must be a function`);
  }
  finite(xOverA, 'xOverA'); finite(yOverA, 'yOverA');
  nonnegative(loadMPa, 'loadMPa'); finite(coefficient, 'coefficient');
  positive(thicknessUm, 'thicknessUm'); positive(wavelengthNm, 'wavelengthNm');
  finite(polarizerAngleDeg, 'polarizerAngleDeg');
  const stress = models.kirsch({x: xOverA, y: yOverA, loadMPa});
  if (stress.excluded) return {excluded: true, principalDifferenceMPa: null, retardanceNm: null, phaseRad: null, transmission: null};
  const principalDifferenceMPa = nonnegative(stress.principalDifferenceMPa, 'principalDifferenceMPa');
  const retardanceNm = finite(models.retardanceNm({coefficient, stressDifferenceMPa: principalDifferenceMPa, thicknessUm}), 'retardanceNm');
  const phaseRad = finite(2 * Math.PI * (retardanceNm / wavelengthNm), 'phaseRad');
  const angleRad = finite(stress.angleRad, 'angleRad') - (polarizerAngleDeg % 180) * Math.PI / 180;
  const transmission = clamp01(models.crossedTransmission({retardanceNm, wavelengthNm, angleRad}));
  return {excluded: false, principalDifferenceMPa, retardanceNm, phaseRad, transmission};
}
