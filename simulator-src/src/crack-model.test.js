import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCrackScenario,crackSample,crackFrame,crackGeometry,crackReferenceSample} from './crack-model.js';
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const layouts=[[1,'row'],[2,'row'],[3,'row'],[4,'row'],[4,'grid']];
function segmentDistance(a,b,h){const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((h.x-a.x)*dx+(h.y-a.y)*dy)/l)):0;return Math.hypot(a.x+t*dx-h.x,a.y+t*dy-h.y);}
test('valid geometry preserves diameter, clear gap and non-overlap',()=>{
 for(const [holeCount,layout] of layouts){const g=crackGeometry({holeCount,layout,diameterUm:100,gapUm:60});assert.equal(g.holes.length,holeCount);
  for(let i=0;i<holeCount;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(g.holes[i].x-g.holes[j].x,g.holes[i].y-g.holes[j].y)>=160-1e-8);
 }
 for(const p of [{diameterUm:0},{gapUm:0},{thicknessUm:0},{coefficient:NaN},{loadMPa:-1},{relaxationTauSec:0},{relaxationFraction:1.1},{thresholdNm:0},{holeCount:0},{holeCount:5},{holeCount:2.5},{holeCount:3,layout:'grid'},{layout:'circle'},{laserEnergyMj:-1},{thicknessExponent:1}])assert.throws(()=>buildCrackScenario(p),RangeError);
});
test('neighbor topology is row n-1 or four grid edges, never diagonals',()=>{
 for(const [holeCount,layout] of layouts){const s=buildCrackScenario({holeCount,layout,thresholdNm:20});
  const expected=layout==='grid'?[[0,1],[2,3],[0,2],[1,3]]:Array.from({length:holeCount-1},(_,i)=>[i,i+1]);
  assert.deepEqual(s.edges,expected);assert.equal(s.paths.length,expected.length);assert.equal(s.candidatePaths.length,expected.length);
  assert.deepEqual(s.paths.map(p=>p.holeIndices),expected);
 }
});
test('all connectors start/end on rims and every segment avoids every hole',()=>{
 for(const [holeCount,layout] of layouts)for(const gapUm of [.01,10,120,500]){
  const s=buildCrackScenario({holeCount,layout,gapUm,thresholdNm:1});
  for(const path of s.candidatePaths){const a=s.holes[path.fromHoleIndex],b=s.holes[path.toHoleIndex],first=path.points[0],last=path.points.at(-1);
   close(Math.hypot(first.x-a.x,first.y-a.y),s.radiusUm);close(Math.hypot(last.x-b.x,last.y-b.y),s.radiusUm);
   for(let i=1;i<path.points.length;i++)for(const h of s.holes)assert.ok(segmentDistance(path.points[i-1],path.points[i],h)>=s.radiusUm*(1-1e-9));
   for(const q of path.points){assert.ok(q.x>=s.domain.xMin&&q.x<=s.domain.xMax&&q.y>=s.domain.yMin&&q.y<=s.domain.yMax);assert.equal(crackSample(s,q.x,q.y,1).excluded,false);}
  }
 }
});
test('single hole explicitly has no inter-hole crack even at high energy',()=>{
 const s=buildCrackScenario({holeCount:1,laserEnergyMj:1000,thresholdNm:1});
 assert.equal(s.hasNeighbor,false);assert.equal(s.status,'no-neighbor');assert.equal(s.onsetTime,Infinity);assert.equal(s.paths.length,0);assert.equal(s.seeds.length,0);
 const frame=crackFrame(s,10);assert.equal(frame.cracked,false);assert.equal(frame.status,'no-neighbor');assert.equal(frame.probe.relaxation,0);assert.ok(Number.isFinite(frame.probe.retardanceNm));
});
test('ligament peak drives common onset and actual probe reaches threshold',()=>{
 const s=buildCrackScenario();assert.ok(s.onsetTime>0&&s.onsetTime<4);assert.equal(s.paths.length,1);
 close(s.maxDeltaBefore,s.params.thresholdNm);close(crackFrame(s,s.onsetTime).probe.deltaNm,s.params.thresholdNm);
 assert.equal(crackFrame(s,s.onsetTime-.001).paths.length,0);assert.equal(crackFrame(s,s.onsetTime).paths.length,1);
 assert.ok(s.candidatePaths.some(p=>p.points.some(q=>Math.hypot(q.x-s.probe.x,q.y-s.probe.y)<1e-9)));
 for(const [holeCount,layout] of layouts.slice(1)){const v=buildCrackScenario({holeCount,layout,thresholdNm:20});for(const p of v.paths)close(p.onsetTime,v.onsetTime);}
});
test('load rises then holds; local stress and retardance release monotonically',()=>{
 const s=buildCrackScenario(),q=s.probe;
 const a=crackSample(s,q.x,q.y,s.onsetTime*.25),b=crackSample(s,q.x,q.y,s.onsetTime*.5);close(b.deltaNm,2*a.deltaNm);
 const start=crackFrame(s,s.onsetTime).probe,middle=crackFrame(s,s.onsetTime+1).probe,late=crackFrame(s,10).probe;
 assert.ok(start.deltaNm>middle.deltaNm&&middle.deltaNm>late.deltaNm);assert.ok(late.deltaNm<start.deltaNm*.21);
 close(late.referenceRetardanceNm,start.referenceRetardanceNm);close(late.deltaNm,late.referenceRetardanceNm*(1-late.relaxation));
 close(crackFrame(s,4).loadMPa,crackFrame(s,10).loadMPa);
 const path=s.paths[0],mid=path.points[Math.floor(path.points.length/2)];assert.ok(crackSample(s,mid.x,mid.y,10).deltaNm<crackSample(s,mid.x,mid.y,s.onsetTime).deltaNm);
 const far=[s.domain.xMax,s.domain.yMin];close(crackSample(s,...far,s.onsetTime).deltaNm,crackSample(s,...far,10).deltaNm,1e-6);
 assert.deepEqual(crackFrame(s,1),crackFrame(s,1));assert.deepEqual(crackFrame(s,10),crackFrame(s,10));
});
test('zero coefficient or load never triggers; zero relaxation preserves field',()=>{
 for(const params of [{loadMPa:0,laserEnergyMj:0},{coefficient:0},{thresholdNm:1e9}]){const s=buildCrackScenario(params);assert.equal(s.onsetTime,Infinity);assert.equal(s.paths.length,0);assert.equal(crackFrame(s,10).cracked,false);}
 const s=buildCrackScenario({relaxationFraction:0});close(crackFrame(s,s.onsetTime).probe.deltaNm,crackFrame(s,10).probe.deltaNm);
});
test('assumed energy/thickness coupling differs from optical path effect',()=>{
 const p={loadMPa:0,laserEnergyMj:6,stressPerMj:10,thicknessExponent:2};
 const a=buildCrackScenario(p),b=buildCrackScenario({...p,laserEnergyMj:12}),c=buildCrackScenario({...p,thicknessUm:250});
 close(a.maxTargetStressMPa,60);close(b.maxTargetStressMPa,120);close(c.maxTargetStressMPa,240);close(b.onsetTime,a.onsetTime/2);close(c.onsetTime,a.onsetTime/2);
 close(crackFrame(a,a.onsetTime).laserEnergyMj,6*a.loadAtHold);assert.equal(a.energyCoupling.assumed,true);
 const t=buildCrackScenario({loadMPa:60,laserEnergyMj:0,thicknessUm:250});close(t.maxDeltaAtMaxLoad,a.maxDeltaAtMaxLoad/2);
});
test('axes remain orthogonal, follow C sign and do not prescribe connectors',()=>{
 const plus=buildCrackScenario({coefficient:3}),minus=buildCrackScenario({coefficient:-3});
 assert.deepEqual(plus.candidatePaths,minus.candidatePaths);
 for(const time of [1,10])for(const [x,y] of [[0,100],[200,120],[-210,-95]]){const a=crackSample(plus,x,y,time),b=crackSample(minus,x,y,time);
  close(Math.cos(a.slowAxisRad-a.fastAxisRad),0);close(Math.abs(Math.cos(a.slowAxisRad-b.fastAxisRad)),1);close(a.deltaNm,b.deltaNm);close(a.transmission,b.transmission);
  close(a.fastAxisRad-a.principalAngleRad,Math.PI/2);close(b.fastAxisRad,b.principalAngleRad);
 }
 const q=plus.probe;close(crackSample(plus,q.x,q.y,1).slowAxisRad,crackSample(plus,q.x,q.y,10).slowAxisRad);
});
test('degenerate optical axes and hole masks return null angles',()=>{
 for(const [params,time] of [[{},0],[{coefficient:0},2],[{coefficient:1e-15},2],[{loadMPa:1e-15},2]]){
  const s=buildCrackScenario(params),v=crackSample(s,0,100,time);assert.equal(v.fastAxisDefined,false);assert.equal(v.slowAxisDefined,false);assert.equal(v.fastAxisRad,null);assert.equal(v.slowAxisRad,null);assert.ok(Number.isFinite(v.transmission));
 }
 const s=buildCrackScenario();for(const h of s.holes){const v=crackSample(s,h.x,h.y,2);assert.equal(v.excluded,true);assert.equal(v.fastAxisRad,null);assert.equal(v.referenceRetardanceNm,null);}
});
test('completed rim junctions have no free-tip fields or misleading tip metric',()=>{
 const s=buildCrackScenario();assert.deepEqual(s.tips,[]);assert.equal(crackFrame(s,10).nearTipMaxStressMPa,null);
 for(const path of s.paths)for(const q of [path.points[0],path.points.at(-1)]){const a=crackSample(s,q.x,q.y,s.onsetTime),b=crackSample(s,q.x,q.y,10);assert.ok(b.stressMagnitudeMPa<a.stressMagnitudeMPa);close(b.sigma1MPa-b.sigma2MPa,b.principalDifferenceMPa);}
});
test('grid samples, intensity and display scales are finite, including C=0',()=>{
 for(const coefficient of [3,0]){const s=buildCrackScenario({holeCount:4,layout:'grid',coefficient});assert.ok(s.stressScaleMPa>0);assert.ok(s.retardanceScaleNm>0);
  for(let x=s.domain.xMin;x<=s.domain.xMax;x+=35)for(let y=s.domain.yMin;y<=s.domain.yMax;y+=35){const v=crackSample(s,x,y,10);if(!v.excluded){for(const value of Object.values(v))if(typeof value==='number')assert.ok(Number.isFinite(value));assert.ok(v.transmission>=0&&v.transmission<=1);}}
 }
});
test('band strength zero exactly recovers same-load Kirsch-only reference',()=>{
 const s=buildCrackScenario({bandStrength:0});close(s.onsetTime,2.8728892818434506);
 for(const time of [0,1,10])for(const [x,y] of [[0,0],[20,30],[-99,56.20498198558558],[300,200]]){
  const a=crackSample(s,x,y,time,{view:'reference'}),b=crackSample(s,x,y,time,{view:'base'});
  assert.equal(a.bandFactor,1);
  for(const key of ['retardanceNm','principalDifferenceMPa','sigmaXMPa','sigmaYMPa','tauXYMPa','sigma1MPa','sigma2MPa','transmission','phaseRad'])close(a[key],b[key]);
 }
});
test('three views share held load, topology, tensor scaling and optical consistency',()=>{
 const s=buildCrackScenario();
 for(const time of [.25,s.onsetTime,10])for(const [x,y] of [[0,0],[15,15],[50,40],[-99,56.20498198558558],[300,200]]){
  const current=crackSample(s,x,y,time),reference=crackReferenceSample(s,x,y,time),base=crackSample(s,x,y,time,{view:'base'});
  assert.deepEqual(reference,crackSample(s,x,y,time,{view:'reference'}));
  assert.ok(current.retardanceNm>=0&&current.retardanceNm<=reference.retardanceNm+1e-9);
  close(reference.retardanceNm,base.retardanceNm*current.bandFactor);
  close(current.retardanceNm,reference.retardanceNm*(1-current.relaxation));
  close(current.referencePrincipalDifferenceMPa,reference.principalDifferenceMPa);close(current.basePrincipalDifferenceMPa,base.principalDifferenceMPa);
  for(const key of ['sigmaXMPa','sigmaYMPa','tauXYMPa','sigma1MPa','sigma2MPa']){
   close(reference[key],base[key]*current.bandFactor);close(current[key],reference[key]*(1-current.relaxation));
  }
  for(const v of [current,reference,base]){close(v.sigma1MPa-v.sigma2MPa,v.principalDifferenceMPa);close(v.phaseRad,2*Math.PI*v.retardanceNm/s.params.wavelengthNm);assert.ok(v.transmission>=0&&v.transmission<=1);if(v.fastAxisDefined)close(Math.cos(v.fastAxisRad-v.slowAxisRad),0);}
  close(reference.relaxation,0);close(base.relaxation,0);
 }
 assert.throws(()=>crackSample(s,0,0,1,{view:'unknown'}),RangeError);
});
test('narrow core unloads more than shoulder Q; shoulder remains above same-load base',()=>{
 for(const [holeCount,layout] of layouts.slice(1)){
  const s=buildCrackScenario({holeCount,layout}),f=crackFrame(s,10),p=f.probe,q=f.shoulderProbe;
  assert.deepEqual(s.shoulderProbe,s.flankProbe);assert.deepEqual(q,f.flankProbe);assert.equal(q.excluded,false);
  assert.ok(p.relaxation>.79);assert.ok(q.relaxation<.1);assert.ok(p.relaxation>q.relaxation);
  assert.ok(q.retardanceNm>q.baseRetardanceNm*1.5);assert.ok(q.retardanceNm<=q.referenceRetardanceNm);
  assert.ok(p.retardanceNm<p.referenceRetardanceNm*.21);
  assert.equal(s.bandModel.assumed,true);
 }
 // Even exceptionally narrow gaps must not put Q inside any hole.
 for(const gapUm of [.01,1,10]){const s=buildCrackScenario({gapUm});assert.ok(s.shoulderProbe);assert.equal(crackSample(s,s.shoulderProbe.x,s.shoulderProbe.y,10).excluded,false);}
});
test('no neighbors means no band, and zero optical/load/release cases stay honest',()=>{
 const single=buildCrackScenario({holeCount:1,bandStrength:100});assert.equal(single.shoulderProbe,null);assert.equal(crackFrame(single,10).shoulderProbe,null);
 const v=crackSample(single,0,100,10);close(v.bandFactor,1);close(v.retardanceNm,v.baseRetardanceNm);
 for(const params of [{loadMPa:0,laserEnergyMj:0},{coefficient:0}]){
  const s=buildCrackScenario(params);assert.equal(s.onsetTime,Infinity);
  for(const view of ['current','reference','base']){const v=crackSample(s,0,0,10,{view});close(v.retardanceNm,0);assert.equal(v.fastAxisRad,null);}
 }
 const s=buildCrackScenario({relaxationFraction:0}),f=crackFrame(s,10);close(f.probe.retardanceNm,f.probe.referenceRetardanceNm);close(f.shoulderProbe.retardanceNm,f.shoulderProbe.referenceRetardanceNm);
 for(const params of [{bandStrength:-1},{bandStrength:NaN},{bandWidthUm:0},{relaxationRadiusUm:0}])assert.throws(()=>buildCrackScenario(params),RangeError);
});
test('fixed common scale includes sampled no-relaxation band field at held load',()=>{
 const s=buildCrackScenario();
 for(const path of s.candidatePaths)for(const q of path.points){const reference=crackReferenceSample(s,q.x,q.y,10);assert.ok(reference.retardanceNm<=s.retardanceScaleNm);assert.ok(reference.principalDifferenceMPa<=s.stressScaleMPa);}
 const noBand=buildCrackScenario({bandStrength:0});close(s.onsetTime,noBand.onsetTime/(1+s.params.bandStrength));
 assert.deepEqual(s.candidatePaths,noBand.candidatePaths);
});
test('Q is a deterministic near-P normal offset, showing default shoulder above relaxed core',()=>{
 const s=buildCrackScenario(),again=buildCrackScenario(),q=s.shoulderProbe,f=crackFrame(s,10);
 assert.deepEqual(q,again.shoulderProbe);assert.equal(q.edgeIndex,s.probe.edgeIndex);
 close(q.distanceToProbeUm,.65*s.params.bandWidthUm);close(q.distanceToPathUm,.65*s.params.bandWidthUm);
 assert.ok(f.shoulderProbe.retardanceNm>f.probe.retardanceNm);
 assert.ok(f.shoulderProbe.retardanceNm/f.shoulderProbe.referenceRetardanceNm>f.probe.retardanceNm/f.probe.referenceRetardanceNm);
 for(const params of [{bandStrength:0},{loadMPa:0,laserEnergyMj:0},{coefficient:0}]){
  const v=buildCrackScenario(params),at=crackFrame(v,10).shoulderProbe;
  assert.ok(v.shoulderProbe);assert.equal(at.excluded,false);assert.ok(Number.isFinite(at.retardanceNm));
  if(params.bandStrength===0)close(at.referenceRetardanceNm,at.baseRetardanceNm);else close(at.retardanceNm,0);
 }
});
