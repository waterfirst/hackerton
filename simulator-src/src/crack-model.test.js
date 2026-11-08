import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCrackScenario,crackSample,crackFrame,crackGeometry} from './crack-model.js';
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('geometry uses clear edge gap, true coordinates and excludes holes',()=>{
 const g=crackGeometry({diameterUm:100,gapUm:60});close(g.holes[1].x-g.holes[0].x-100,60);
 const s=buildCrackScenario();for(const h of s.holes)assert.equal(crackSample(s,h.x,h.y,3).excluded,true);
 for(const p of [{diameterUm:0},{gapUm:-1},{gapUm:0},{coefficient:NaN},{loadMPa:-1},{relaxationTauSec:0},{relaxationFraction:1.1},{thresholdNm:0}])assert.throws(()=>buildCrackScenario(p),RangeError);
});
test('threshold ramps deterministically, holds load, drops local retardance without replay',()=>{
 const s=buildCrackScenario(),q=s.probe;assert.ok(s.onsetTime>0&&s.onsetTime<4);assert.equal(s.paths.length,2);
 close(s.maxDeltaBefore,s.params.thresholdNm);close(crackSample(s,q.x,q.y,s.onsetTime).deltaNm,s.params.thresholdNm);
 const a=crackSample(s,q.x,q.y,s.onsetTime*.25),b=crackSample(s,q.x,q.y,s.onsetTime*.5);close(b.deltaNm,2*a.deltaNm);
 const start=crackSample(s,q.x,q.y,s.onsetTime),late=crackSample(s,q.x,q.y,10);assert.ok(late.deltaNm<start.deltaNm*.21);
 close(crackFrame(s,4).loadMPa,crackFrame(s,10).loadMPa);assert.equal(crackFrame(s,0).paths.length,0);
 assert.deepEqual(crackFrame(s,10),crackFrame(s,10));assert.deepEqual(crackFrame(s,1),crackFrame(s,1));
 const far=[s.domain.xMax,s.domain.yMin];close(crackSample(s,...far,s.onsetTime).deltaNm,crackSample(s,...far,10).deltaNm,1e-6);
});
test('axis follows coefficient sign convention, zero anisotropy has undefined fast axis',()=>{
 const plus=buildCrackScenario({coefficient:3}),minus=buildCrackScenario({coefficient:-3});
 const a=crackSample(plus,0,100,1),b=crackSample(minus,0,100,1);close(a.fastAxisRad-a.principalAngleRad,Math.PI/2);close(b.fastAxisRad,b.principalAngleRad);close(a.deltaNm,b.deltaNm);close(a.transmission,b.transmission);
 assert.equal(crackSample(plus,0,100,0).fastAxisDefined,false);
});
test('zero optical/load inputs do not trigger and zero release preserves stress',()=>{
 for(const params of [{loadMPa:0},{coefficient:0},{thresholdNm:1e9}]){
  const s=buildCrackScenario(params);assert.equal(s.onsetTime,Infinity);assert.equal(s.paths.length,0);assert.equal(crackFrame(s,10).cracked,false);
 }
 const s=buildCrackScenario({relaxationFraction:0});close(crackSample(s,s.probe.x,s.probe.y,s.onsetTime).deltaNm,crackSample(s,s.probe.x,s.probe.y,10).deltaNm);
});
test('frozen path segments never cross a hole and align with the fast line field',()=>{
 for(const coefficient of [3,-3]) {
  const s=buildCrackScenario({coefficient});
  for(const path of s.paths)for(let i=1;i<path.points.length;i++) {
   const a=path.points[i-1],b=path.points[i],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
   for(const h of s.holes){const t=Math.max(0,Math.min(1,((h.x-a.x)*dx+(h.y-a.y)*dy)/l));assert.ok(Math.hypot(a.x+t*dx-h.x,a.y+t*dy-h.y)>=h.radiusUm*(1-1e-9));}
   const aa=crackSample(s,a.x,a.y,1).fastAxisRad,bb=crackSample(s,b.x,b.y,1).fastAxisRad;
   const alignment=Math.max(Math.abs((dx*Math.cos(aa)+dy*Math.sin(aa))/Math.sqrt(l)),Math.abs((dx*Math.cos(bb)+dy*Math.sin(bb))/Math.sqrt(l)));assert.ok(alignment>.99999);
  }
 }
});
test('grid outputs and optical intensities remain finite and bounded',()=>{
 const s=buildCrackScenario({gapUm:10});for(let x=s.domain.xMin;x<=s.domain.xMax;x+=25)for(let y=s.domain.yMin;y<=s.domain.yMax;y+=25){const v=crackSample(s,x,y,10);if(!v.excluded){for(const value of Object.values(v))if(typeof value==='number')assert.ok(Number.isFinite(value));assert.ok(v.transmission>=0&&v.transmission<=1);}}
});
test('slow/fast line axes are orthogonal and swap with coefficient sign',()=>{
 const plus=buildCrackScenario({coefficient:3}),minus=buildCrackScenario({coefficient:-3});
 for(const [x,y] of [[0,100],[200,120],[-210,-95]]) {
  const a=crackSample(plus,x,y,1),b=crackSample(minus,x,y,1);
  assert.equal(a.slowAxisDefined,true);close(Math.cos(a.slowAxisRad-a.fastAxisRad),0);
  close(Math.abs(Math.cos(a.slowAxisRad-b.fastAxisRad)),1);
  close(Math.abs(Math.cos(a.fastAxisRad-b.slowAxisRad)),1);
 }
});
test('zero and negligible optical anisotropy mask both axis angles',()=>{
 for(const [params,time] of [[{},0],[{coefficient:0},2],[{coefficient:1e-15},2],[{loadMPa:1e-15},2]]) {
  const s=buildCrackScenario(params),v=crackSample(s,0,100,time);
  assert.equal(v.fastAxisDefined,false);assert.equal(v.slowAxisDefined,false);
  assert.equal(v.fastAxisRad,null);assert.equal(v.slowAxisRad,null);
  assert.ok(Number.isFinite(v.transmission));
 }
 const s=buildCrackScenario(),v=crackSample(s,s.holes[0].x,0,2);
 assert.equal(v.fastAxisRad,null);assert.equal(v.slowAxisRad,null);assert.equal(v.referenceRetardanceNm,null);
});
test('reference retardance shares the frozen load and omits local relaxation',()=>{
 const s=buildCrackScenario();
 for(const time of [0,1,s.onsetTime]) {const v=crackFrame(s,time).probe;close(v.referenceRetardanceNm,v.retardanceNm);}
 const initial=crackFrame(s,s.onsetTime).probe,late=crackFrame(s,10).probe;
 close(initial.referenceRetardanceNm,late.referenceRetardanceNm);
 assert.ok(late.referenceRetardanceNm>late.retardanceNm);
 close(late.retardanceNm,late.referenceRetardanceNm*(1-late.relaxation));
});
test('one to four holes support row and four-hole 2x2 layouts without overlap',()=>{
 for(const holeCount of [1,2,3,4])for(const layout of holeCount===4?['row','grid']:['row']) {
  const s=buildCrackScenario({holeCount,layout,laserEnergyMj:6,loadMPa:0});assert.equal(s.holes.length,holeCount);
  for(let i=0;i<holeCount;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(s.holes[i].x-s.holes[j].x,s.holes[i].y-s.holes[j].y)>=s.params.diameterUm+s.params.gapUm-1e-9);
  assert.ok(s.paths.length>0);assert.ok(Number.isFinite(s.probe.onsetTime));assert.ok(s.tips.length>0);
  assert.ok(s.stressScaleMPa>=s.sampledMaxStressDifferenceMPa);assert.ok(s.retardanceScaleNm>0);
  const a=crackFrame(s,s.onsetTime).probe,b=crackFrame(s,s.onsetTime+1).probe,c=crackFrame(s,10).probe;
  assert.ok(a.deltaNm>b.deltaNm&&b.deltaNm>c.deltaNm);
 }
 for(const p of [{holeCount:0},{holeCount:5},{holeCount:2.5},{holeCount:3,layout:'grid'},{layout:'circle'},{laserEnergyMj:-1},{thicknessExponent:1}])assert.throws(()=>buildCrackScenario(p));
});
test('assumed energy coupling makes higher energy and thinner glass trigger earlier',()=>{
 const base={loadMPa:0,laserEnergyMj:6,stressPerMj:10,thicknessExponent:2};
 const a=buildCrackScenario(base),b=buildCrackScenario({...base,laserEnergyMj:12}),c=buildCrackScenario({...base,thicknessUm:250});
 close(a.maxTargetStressMPa,60);close(b.maxTargetStressMPa,120);close(c.maxTargetStressMPa,240);
 close(b.onsetTime,a.onsetTime/2);close(c.onsetTime,a.onsetTime/2);
 close(crackFrame(a,a.onsetTime).laserEnergyMj,6*a.loadAtHold);
 assert.equal(a.energyCoupling.assumed,true);
 // With stress held fixed instead, reducing optical path alone REDUCES retardance.
 const fixed1=buildCrackScenario({loadMPa:60,laserEnergyMj:0}),fixed2=buildCrackScenario({loadMPa:60,laserEnergyMj:0,thicknessUm:250});
 close(fixed2.maxDeltaAtMaxLoad,fixed1.maxDeltaAtMaxLoad/2);
 const off=buildCrackScenario({loadMPa:0,laserEnergyMj:0});assert.equal(off.onsetTime,Infinity);assert.equal(off.maxTargetStressMPa,0);
});
test('post-crack tensor redistributes stress near tips and rotates optical axes',()=>{
 const s=buildCrackScenario(),tip=s.tips[0],r=s.params.tipCoreUm,a=tip.tangentRad+.5;
 const x=tip.x+r*Math.cos(a),y=tip.y+r*Math.sin(a);
 const pre=crackSample(s,x,y,s.onsetTime),post=crackSample(s,x,y,10);
 assert.ok(post.stressMagnitudeMPa>pre.stressMagnitudeMPa*2);
 assert.ok(Math.abs(Math.sin(post.slowAxisRad-pre.slowAxisRad))>.05);
 close(post.sigma1MPa-post.sigma2MPa,post.principalDifferenceMPa);
 close(Math.cos(post.slowAxisRad-post.fastAxisRad),0);
 assert.ok(crackFrame(s,10).nearTipMaxStressMPa>=post.stressMagnitudeMPa*.9);
 const fpre=crackSample(s,s.domain.xMax,s.domain.yMin,s.onsetTime),fpost=crackSample(s,s.domain.xMax,s.domain.yMin,10);
 close(fpre.sigmaXMPa,fpost.sigmaXMPa,1e-6);close(fpre.sigmaYMPa,fpost.sigmaYMPa,1e-6);
 const core=crackSample(s,tip.x,tip.y,10);assert.ok(Number.isFinite(core.stressMagnitudeMPa));
});
test('domain retains full tip support for every default array layout',()=>{
 for(const holeCount of [1,2,3,4])for(const layout of holeCount===4?['row','grid']:['row']) {
  const s=buildCrackScenario({holeCount,layout});assert.ok(s.tips.length>0);
  for(const tip of s.tips) {
   const r=s.params.tipRadiusUm,d=s.domain;
   assert.ok(tip.x-r>=d.xMin&&tip.x+r<=d.xMax);
   assert.ok(tip.y-r>=d.yMin&&tip.y+r<=d.yMax);
  }
  // Domain expansion never rescales physical hole coordinates or edge gap.
  if(layout==='row'&&holeCount>1)close(s.holes[1].x-s.holes[0].x,s.params.diameterUm+s.params.gapUm);
 }
});
test('near-tip maximum metric uses largest tensile principal stress sigma1',()=>{
 const s=buildCrackScenario(),time=10;let expected=0;
 for(const tip of s.tips)for(const r of [0,s.params.tipCoreUm,2*s.params.tipCoreUm])for(let i=0;i<12;i++) {
  const v=crackSample(s,tip.x+r*Math.cos(2*Math.PI*i/12),tip.y+r*Math.sin(2*Math.PI*i/12),time);
  if(!v.excluded)expected=Math.max(expected,v.sigma1MPa);
 }
 close(crackFrame(s,time).nearTipMaxStressMPa,expected);
});
