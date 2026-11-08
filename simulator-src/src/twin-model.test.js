import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {clamp01, processState, sceneGeometry, opticalSample} from './twin-model.js';
const models = createRequire(import.meta.url)('../../sim/models.js');
const close = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const geometry = {thicknessUm: 500, diameterUm: 100, depthUm: 30};
const optics = {xOverA: 0, yOverA: 1, loadMPa: 50, coefficient: 3, thicknessUm: 500, wavelengthNm: 550, polarizerAngleDeg: 45};

test('timeline has exact endpoints and five explanatory stages', () => {
  assert.equal(processState(0).phaseId, 'initial');
  assert.equal(processState(.09).phaseId, 'strengthening');
  assert.equal(processState(.18).phaseId, 'drilling');
  assert.equal(processState(.62).phaseId, 'through');
  assert.equal(processState(.72).phaseId, 'fill');
  assert.deepEqual([processState(0).strengthening, processState(.18).strengthening], [0, 1]);
  assert.deepEqual([processState(.18).drillFraction, processState(.62).drillFraction], [0, 1]);
  assert.deepEqual([processState(.72).fillFraction, processState(1).fillFraction], [0, 1]);
  close(processState(.4).drillFraction, .5);
  close(processState(.86).fillFraction, .5);
  assert.deepEqual(processState(-1), processState(0));
  assert.deepEqual(processState(2), processState(1));
});
test('prescribed stage fractions are bounded and monotone, never fill before opening', () => {
  let last = processState(0);
  for (let i = 0; i <= 1000; i++) {
    const current = processState(i / 1000);
    for (const key of ['strengthening', 'drillFraction', 'fillFraction']) {
      assert.ok(current[key] >= last[key] && current[key] <= 1);
    }
    if (current.fillFraction > 0) assert.equal(current.drillFraction, 1);
    last = current;
  }
});
test('geometry preserves physical aspect ratio and linear cylindrical fill volume', () => {
  const g = sceneGeometry(geometry);
  assert.equal(g.plateWidthUm, 700);
  assert.equal(g.radiusUm, 50);
  assert.equal(g.halfThicknessUm, 250);
  assert.equal(g.halfThickness, 250);
  assert.equal(g.halfWidthUm, 350);
  assert.equal(sceneGeometry({...geometry, diameterUm: 200}).plateWidthUm, 1200);
  for (const p of [.72, .8, .86, 1]) {
    const f = processState(p).fillFraction;
    const fillHeight = g.thicknessUm * f;
    close(Math.PI * g.radiusUm ** 2 * fillHeight / g.holeVolumeUm3, f);
    assert.ok(fillHeight >= 0 && fillHeight <= g.thicknessUm);
  }
});
test('zero stress is dark, angle changes only transmission, and π-periodicity holds', () => {
  const zero = opticalSample(models, {...optics, loadMPa: 0});
  assert.equal(zero.principalDifferenceMPa, 0);
  assert.equal(zero.retardanceNm, 0);
  assert.equal(zero.phaseRad, 0);
  assert.equal(zero.transmission, 0);
  const bright = opticalSample(models, optics);
  const dark = opticalSample(models, {...optics, polarizerAngleDeg: 0});
  close(bright.principalDifferenceMPa, 150);
  close(bright.retardanceNm, 225);
  close(bright.phaseRad, 2 * Math.PI * 225 / 550);
  assert.ok(bright.transmission > .8);
  close(dark.transmission, 0);
  assert.equal(bright.retardanceNm, dark.retardanceNm);
  close(bright.transmission, opticalSample(models, {...optics, polarizerAngleDeg: 225}).transmission);
});
test('hole interior is excluded, not a zero-stress measurement', () => {
  assert.deepEqual(opticalSample(models, {...optics, xOverA: 0, yOverA: 0}), {
    excluded: true, principalDifferenceMPa: null, retardanceNm: null, phaseRad: null, transmission: null,
  });
});
test('invalid and overflowing inputs fail safely', () => {
  assert.equal(clamp01(-1), 0); assert.equal(clamp01(2), 1);
  for (const value of [NaN, Infinity, -Infinity, '0.5', null, undefined]) {
    assert.throws(() => clamp01(value), RangeError);
    assert.throws(() => processState(value), RangeError);
  }
  for (const patch of [{thicknessUm: 0}, {diameterUm: -1}, {depthUm: -1}, {depthUm: 250}, {depthUm: NaN}, {diameterUm: Number.MAX_VALUE}]) {
    assert.throws(() => sceneGeometry({...geometry, ...patch}), RangeError);
  }
  for (const patch of [{xOverA: NaN}, {yOverA: Infinity}, {loadMPa: -1}, {coefficient: Infinity}, {thicknessUm: 0}, {wavelengthNm: 0}, {polarizerAngleDeg: NaN}]) {
    assert.throws(() => opticalSample(models, {...optics, ...patch}), RangeError);
  }
  assert.throws(() => opticalSample({}, optics), TypeError);
  assert.throws(() => opticalSample({...models, crossedTransmission: () => NaN}, optics), RangeError);
});

test('two-hole pitch, ligament and summed cylindrical volume follow physical controls',()=>{
  for(const diameterUm of [20,100,500]) for(const gapUm of [1,120,1000]) {
    const g=sceneGeometry({...geometry,diameterUm,gapUm});
    assert.equal(g.holeCount,2);
    assert.equal(g.pitchUm,diameterUm+gapUm);
    assert.deepEqual(g.centersUm,[{x:-g.pitchUm/2,y:0},{x:g.pitchUm/2,y:0}]);
    close(g.centersUm[1].x-g.centersUm[0].x-2*g.radiusUm,gapUm);
    assert.ok(g.centersUm[1].x+g.radiusUm<g.halfWidthUm);
    close(g.totalHoleVolumeUm3,2*g.holeVolumeUm3);
    for(const fraction of [0,.25,.5,1]) close(2*Math.PI*g.radiusUm**2*g.thicknessUm*fraction/g.totalHoleVolumeUm3,fraction);
  }
  assert.equal(sceneGeometry(geometry).gapUm,120);
  for(const gapUm of [0,-1,NaN,Infinity,null,'120']) assert.throws(()=>sceneGeometry({...geometry,gapUm}),RangeError);
});

test('one through four holes support centered rows and four-hole grid with exact volume',()=>{
  for(const holeCount of [1,2,3,4]) for(const layout of holeCount===4?['row','grid']:['row']) {
    const g=sceneGeometry({...geometry,holeCount,layout});
    assert.equal(g.holeCount,holeCount);assert.equal(g.layout,layout);assert.equal(g.centersUm.length,holeCount);
    close(g.totalHoleVolumeUm3,holeCount*g.holeVolumeUm3);
    close(g.centersUm.reduce((sum,c)=>sum+c.x,0),0);close(g.centersUm.reduce((sum,c)=>sum+c.y,0),0);
    for(const c of g.centersUm) {
      assert.ok(Math.abs(c.x)+g.radiusUm<g.halfWidthUm);
      assert.ok(Math.abs(c.y)+g.radiusUm<g.halfWidthUm);
    }
    if(layout==='row') assert.deepEqual(g.centersUm,Array.from({length:holeCount},(_,i)=>({x:(i-(holeCount-1)/2)*g.pitchUm,y:0})));
    else assert.deepEqual(g.centersUm,[{x:-110,y:-110},{x:110,y:-110},{x:-110,y:110},{x:110,y:110}]);
  }
  for(const holeCount of [0,5,1.5,NaN,'2',null]) assert.throws(()=>sceneGeometry({...geometry,holeCount}),RangeError);
  for(const holeCount of [1,2,3]) assert.throws(()=>sceneGeometry({...geometry,holeCount,layout:'grid'}),RangeError);
  assert.throws(()=>sceneGeometry({...geometry,layout:'other'}),RangeError);
});
