import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {clamp01, processState, PROCESS_MODEL, sceneGeometry, opticalSample, opticalImageData, resolvedAnalyzerAngle, SINGLE_HOLE_COLOR_EXAMPLE} from './twin-model.js';
const models = createRequire(import.meta.url)('../../sim/models.js');
const close = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const geometry = {thicknessUm: 500, diameterUm: 100, depthUm: 30};
const optics = {xOverA: 0, yOverA: 1, loadMPa: 50, coefficient: 3, thicknessUm: 500, wavelengthNm: 550, polarizerAngleDeg: 45};

test('timeline includes deposition, continuous overburden, CMP, and completed vias', () => {
  assert.equal(processState(0).phaseId, 'initial');
  assert.equal(processState(.09).phaseId, 'strengthening');
  assert.equal(processState(.18).phaseId, 'drilling');
  assert.equal(processState(.62).phaseId, 'through');
  assert.equal(processState(.72).phaseId, 'sputter');
  assert.deepEqual([processState(0).strengthening, processState(.18).strengthening], [0, 1]);
  assert.deepEqual([processState(.18).drillFraction, processState(.62).drillFraction], [0, 1]);
  assert.deepEqual([processState(.72).fillFraction, processState(1).fillFraction], [0, 1]);
  close(processState(.4).drillFraction, .5);
  close(processState(.79).fillFraction, .5);
  assert.equal(processState(.86).phaseId, 'overburden');
  assert.equal(processState(.90).phaseId, 'cmp');
  assert.equal(processState(1).phaseId, 'complete');
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
  close(zero.transmission, 0);
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
    excluded: true, principalDifferenceMPa: null, retardanceNm: null, phaseRad: null, transmission: null, linearRgb: null,
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
  for (const patch of [{xOverA: NaN}, {yOverA: Infinity}, {loadMPa: -1}, {coefficient: Infinity}, {thicknessUm: 0}, {wavelengthNm: 0}, {polarizerAngleDeg: NaN}, {analyzerAngleDeg: Infinity}, {spectrumMode: 'invalid'}]) {
    assert.throws(() => opticalSample(models, {...optics, ...patch}), RangeError);
  }
  assert.throws(() => opticalSample({}, optics), TypeError);
  assert.throws(() => opticalSample({...models, kirsch: () => ({excluded:false,principalDifferenceMPa:NaN,angleRad:0})}, optics), RangeError);
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

test('independent analyzer obeys crossed darkness and parallel brightness at zero stress in every spectrum', () => {
  for (const spectrumMode of ['mono','white','rgb']) for (const polarizerAngleDeg of [0,25,90,180]) {
    const crossed=opticalSample(models,{...optics,loadMPa:0,spectrumMode,polarizerAngleDeg,analyzerAngleDeg:polarizerAngleDeg+90});
    const parallel=opticalSample(models,{...optics,loadMPa:0,spectrumMode,polarizerAngleDeg,analyzerAngleDeg:polarizerAngleDeg});
    close(crossed.transmission,0);close(parallel.transmission,1);
    assert.equal(crossed.retardanceNm,parallel.retardanceNm);
    assert.equal(crossed.principalDifferenceMPa,parallel.principalDifferenceMPa);
    assert.ok(crossed.linearRgb.every(v=>Math.abs(v)<1e-12));
  }
});

test('analyzer rotation, spectrum, wavelength and exposure do not alter stress or retardance', () => {
  const baseline=opticalSample(models,optics);
  const originalStress=models.kirsch({x:optics.xOverA,y:optics.yOverA,loadMPa:optics.loadMPa});
  for (const spectrumMode of ['mono','white','rgb']) for (const wavelengthNm of [400,550,750]) for (const polarizerAngleDeg of [0,45,160]) for (const analyzerAngleDeg of [0,45,135]) {
    const sample=opticalSample(models,{...optics,spectrumMode,wavelengthNm,polarizerAngleDeg,analyzerAngleDeg,displayWhitePoint:.15});
    assert.equal(sample.principalDifferenceMPa,baseline.principalDifferenceMPa);
    assert.equal(sample.retardanceNm,baseline.retardanceNm);
    assert.deepEqual(models.kirsch({x:optics.xOverA,y:optics.yOverA,loadMPa:optics.loadMPa}),originalStress);
    assert.ok(sample.transmission>=0&&sample.transmission<=1);
    assert.ok(sample.linearRgb.every(Number.isFinite));
  }
});

test('crossed lock follows polarizer while independent analyzer retains its own angle', () => {
  for (let alpha=0;alpha<=180;alpha++) {
    const beta=resolvedAnalyzerAngle(alpha,17,true);
    assert.ok(beta>=0&&beta<=180);
    close(Math.abs(Math.sin((beta-alpha)*Math.PI/180)),1);
    assert.equal(resolvedAnalyzerAngle(alpha,17,false),17);
  }
  for (const value of [NaN,Infinity]) assert.throws(()=>resolvedAnalyzerAngle(value,90,true),RangeError);
});

test('display exposure changes only sRGB pixels, never the physical sample', () => {
  const state={...optics,spectrumMode:'white',analyzerAngleDeg:135,displayWhitePoint:1};
  const base=opticalSample(models,state),bright=opticalSample(models,{...state,displayWhitePoint:.15});
  assert.deepEqual(base,bright);
  const a=opticalImageData(models,state,24),b=opticalImageData(models,{...state,displayWhitePoint:.15},24);
  assert.ok(a.some((v,i)=>i%4!==3&&b[i]>v),'reduced white point brightens visible color channels');
  for (let i=0;i<a.length;i++) assert.ok(i%4===3?a[i]===b[i]:a[i]<=b[i]);
  for (const size of [0,1.5,1025]) assert.throws(()=>opticalImageData(models,state,size),RangeError);
  assert.throws(()=>opticalImageData(models,{...state,displayWhitePoint:0},2),RangeError);
});

test('disclosed synthetic example produces bright multicolored fringes without a stress palette', () => {
  const data=opticalImageData(models,SINGLE_HOLE_COLOR_EXAMPLE,80);
  let visible=0,colored=0,bright=0;const hues=new Set();
  for (let i=0;i<data.length;i+=4) {
    if (!data[i+3]) continue;
    visible++;
    const rgb=[data[i],data[i+1],data[i+2]],max=Math.max(...rgb),min=Math.min(...rgb);
    if (max>100) bright++;
    if (max-min>30) {colored++;hues.add(rgb.indexOf(max));}
  }
  assert.ok(bright>visible*.3,'example is visible with white point 1');
  assert.ok(colored>visible*.05,'spectral transfer yields chromatic variation');
  assert.equal(hues.size,3,'different locations have red, green and blue channel dominance');
  const sample=opticalSample(models,{...SINGLE_HOLE_COLOR_EXAMPLE,xOverA:0,yOverA:1});
  close(sample.retardanceNm,1620); // 6 C × (3 × 90 MPa) × 1000 µm × 10⁻³
  assert.ok(sample.retardanceNm/550>1);
});


test('CMP removes top overburden monotonically without removing via Cu',()=>{
  const before=processState(.88);
  close(before.fillFraction,1);close(before.surfaceCuFraction,1);close(before.cmpFraction,0);
  const halfway=processState(.95);
  close(halfway.fillFraction,1);close(halfway.surfaceCuFraction,.5);close(halfway.cmpFraction,.5);
  const end=processState(1);
  close(end.fillFraction,1);close(end.surfaceCuFraction,0);close(end.cmpFraction,1);
  let last=processState(.9);
  for(let i=0;i<=100;i++){
    const current=processState(.9+i/1000);
    assert.equal(current.fillFraction,1);
    assert.ok(current.surfaceCuFraction<=last.surfaceCuFraction);
    assert.ok(current.cmpFraction>=last.cmpFraction);
    last=current;
  }
});
test('surface Cu appears only after drilling, is bounded, and scrubs reversibly',()=>{
  for(let i=0;i<=1000;i++){
    const state=processState(i/1000);
    for(const key of ['depositionFraction','surfaceCuFraction','cmpFraction'])assert.ok(state[key]>=0&&state[key]<=1);
    if(state.surfaceCuFraction>0)assert.equal(state.drillFraction,1);
    if(state.cmpFraction>0)assert.equal(state.fillFraction,1);
  }
  assert.deepEqual(processState(.88),processState(.88));
  assert.equal(processState(1).surfaceCuFraction,0);
  assert.equal(processState(.88).surfaceCuFraction,1);
  assert.equal(processState(0).surfaceCuFraction,0);
  assert.equal(PROCESS_MODEL.filmDisplayThicknessOverGlass,.045);
  assert.match(PROCESS_MODEL.assumptions.join(' '),/not guaranteed/);
});
