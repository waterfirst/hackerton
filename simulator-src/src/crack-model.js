/** User-prescribed optical crack hypothesis, NOT a fracture predictor or FEM.
 * Circular Kirsch tensors are superposed and duplicated remote tensors
 * subtracted. This is NOT the exact interacting multi-hole boundary solution.
 * Coordinates µm, stress MPa, C in Brewster (10^-12 Pa^-1), retardance nm.
 * n1-n2=C(sigma1-sigma2): C>0 makes the minor principal axis optically fast.
 * Curved nearest-neighbor rim connections are prescribed from the user's
 * reference, NOT fast-axis streamlines or predicted propagation trajectories.
 * One sampled ligament threshold activates the complete prescribed network.
 * Scalar local stress relief is not an equilibrium elasticity solution.
 * Completed rim junctions are not free crack tips: no singular tip field is used.
 * No universal threshold, toughness, growth law or FEM result is inferred.
 */
const TAU = 2 * Math.PI;
const sampleCaches = new WeakMap();
function finite(v, name) { if (!Number.isFinite(v)) throw new RangeError(`${name} must be finite`); return v; }
function positive(v, name, zero=false) { finite(v,name); if (zero ? v<0 : v<=0) throw new RangeError(`${name} must be ${zero?'nonnegative':'positive'}`); return v; }
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
function parameters(input={}) {
  const p={holeCount:2,layout:'row',laserEnergyMj:0,stressPerMj:10,thicknessExponent:2,diameterUm:120,gapUm:120,loadMPa:60,coefficient:3,thicknessUm:500,wavelengthNm:550,polarizerAngleDeg:0,thresholdNm:150,relaxationFraction:.8,relaxationTauSec:.8,...input};
  for(const k of ['diameterUm','gapUm','thicknessUm','wavelengthNm','thresholdNm','relaxationTauSec']) positive(p[k],k);
  if(!Number.isInteger(p.holeCount)||p.holeCount<1||p.holeCount>4)throw new RangeError('holeCount must be 1..4');
  if(!['row','grid'].includes(p.layout)||(p.layout==='grid'&&p.holeCount!==4))throw new RangeError('grid layout requires four holes');
  for(const k of ['laserEnergyMj','stressPerMj'])positive(p[k],k,true);
  positive(p.thicknessExponent,'thicknessExponent');if(p.thicknessExponent<=1)throw new RangeError('thicknessExponent must exceed one');
  positive(p.loadMPa,'loadMPa',true); finite(p.coefficient,'coefficient');finite(p.polarizerAngleDeg,'polarizerAngleDeg');
  finite(p.relaxationFraction,'relaxationFraction'); if(p.relaxationFraction<0||p.relaxationFraction>1) throw new RangeError('relaxationFraction must be in [0,1]');
  p.relaxationRadiusUm??=.3*p.diameterUm;
  positive(p.relaxationRadiusUm,'relaxationRadiusUm');
  p.maxTargetStressMPa=finite(p.loadMPa+p.stressPerMj*p.laserEnergyMj*(500/p.thicknessUm)**p.thicknessExponent,'target stress');
  return p;
}
export function crackGeometry(input={}) {
  const p=parameters(input),radiusUm=p.diameterUm/2,offset=(p.diameterUm+p.gapUm)/2;
  const holes=p.layout==='grid'?[-1,1].flatMap(y=>[-1,1].map(x=>({x:x*offset,y:y*offset,radiusUm}))):Array.from({length:p.holeCount},(_,i)=>({x:(i-(p.holeCount-1)/2)*2*offset,y:0,radiusUm}));
  const margin=2*p.diameterUm;
  const xMax=Math.max(...holes.map(h=>Math.abs(h.x)))+margin,yMax=Math.max(...holes.map(h=>Math.abs(h.y)))+margin;
  const domain={xMin:-xMax,xMax,yMin:-yMax,yMax,width:2*xMax,height:2*yMax};
  for(const v of Object.values(domain)) finite(v,'geometry');
  return {domain,holes,centers:holes,holeCenters:holes,radiusUm,diameterUm:p.diameterUm,gapUm:p.gapUm};
}
function unitTensor(g,x,y) {
  let xx=1-g.holes.length,yy=0,xy=0;
  for(const h of g.holes) {
    const dx=x-h.x,dy=y-h.y,r=Math.hypot(dx,dy)/h.radiusUm;
    if(r<1-1e-10) return null;
    const a=Math.atan2(dy,dx),c=Math.cos(a),s=Math.sin(a),q=1/Math.max(1,r)**2;
    const rr=.5*((1-q)+(1-4*q+3*q*q)*Math.cos(2*a));
    const tt=.5*((1+q)-(1+3*q*q)*Math.cos(2*a));
    const rt=-.5*(1+2*q-3*q*q)*Math.sin(2*a);
    xx+=rr*c*c+tt*s*s-2*rt*s*c; yy+=rr*s*s+tt*c*c+2*rt*s*c; xy+=(rr-tt)*s*c+rt*(c*c-s*s);
  }
  return {xx,yy,xy,difference:Math.hypot(xx-yy,2*xy),angle:.5*Math.atan2(2*xy,xx-yy)};
}
function fastAngle(t,p) {return t.angle+(p.coefficient>0?Math.PI/2:0);}
function delta(t,p) { return t.difference*p.maxTargetStressMPa*Math.abs(p.coefficient)*p.thicknessUm*1e-3; }
/** A rim-to-rim curve within the clear corridor between adjacent circles.
 * Straight rim shoulders join a cubic smoothstep across the open edge gap.
 * No point or line segment enters either hole, even at very small gaps.
 */
function connector(g,fromHoleIndex,toHoleIndex) {
  const a=g.holes[fromHoleIndex],b=g.holes[toHoleIndex],r=g.radiusUm;
  const length=Math.hypot(b.x-a.x,b.y-a.y),ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
  const points=[],rimU=.35,rimV=Math.sqrt(1-rimU*rimU);
  function point(u,v){points.push({x:a.x+u*ux-v*uy,y:a.y+u*uy+v*ux});}
  for(let i=0;i<=12;i++)point(r*(rimU+(1-rimU)*i/12),rimV*r);
  for(let i=1;i<=80;i++){const t=i/80;point(r+(length-2*r)*t,rimV*r*(1-2*t*t*(3-2*t)));}
  for(let i=1;i<=12;i++)point(length-r+(1-rimU)*r*i/12,-rimV*r);
  return {fromHoleIndex,toHoleIndex,holeIndices:[fromHoleIndex,toHoleIndex],points};
}
export function buildCrackScenario(input={}) {
  const p=parameters(input),g=crackGeometry(p),d=g.domain;
  const edges=p.layout==='grid'?[[0,1],[2,3],[0,2],[1,3]]:Array.from({length:p.holeCount-1},(_,i)=>[i,i+1]);
  const candidatePaths=edges.map(([a,b])=>connector(g,a,b));
  let peak=0,peakPoint=null;
  const seeds=candidatePaths.map((path,seedIndex)=>{
    let best={...path.points[0],deltaNm:-1};
    for(const q of path.points){const value=delta(unitTensor(g,q.x,q.y),p);if(value>best.deltaNm){best={...q,deltaNm:value};}}
    if(best.deltaNm>peak||peakPoint===null){peak=best.deltaNm;peakPoint={x:best.x,y:best.y};}
    return {...best,holeIndex:path.fromHoleIndex,edgeIndex:seedIndex,seedIndex,ligamentSeed:true};
  });
  finite(peak,'peak retardance');
  const hasNeighbor=edges.length>0;
  const onsetTime=hasNeighbor&&peak>=p.thresholdNm?4*p.thresholdNm/peak:Infinity;
  const loadAtHold=Number.isFinite(onsetTime)?onsetTime/4:1;
  for(const seed of seeds){seed.deltaAtMaxLoadNm=seed.deltaNm;seed.deltaNm*=loadAtHold;seed.onsetTime=onsetTime;seed.locallyReachedThreshold=seed.deltaNm>=p.thresholdNm*(1-1e-6);}
  const paths=Number.isFinite(onsetTime)?candidatePaths.map((path,seedIndex)=>({...path,seedIndex,onsetTime})):[];
  // A connection ending at a hole rim has no free crack tip.
  const tips=[];
  const fallbackProbe={x:g.holes[0].x,y:g.holes[0].y+g.radiusUm,holeIndex:0};
  const probe=seeds.reduce((best,s)=>!best||s.deltaNm>best.deltaNm?s:best,null)||fallbackProbe;
  const energyCoupling={assumed:true,referenceThicknessUm:500,stressPerMj:p.stressPerMj,thicknessExponent:p.thicknessExponent,description:'Prescribed stress = background + κ E (500/t)^p; not a calibrated laser thermoelastic model.'};
  const scenario={params:p,geometry:g,...g,tips,edges,candidatePaths,hasNeighbor,status:!hasNeighbor?'no-neighbor':Number.isFinite(onsetTime)?'threshold-reached':'below-threshold',thresholdBasis:'maximum along prescribed ligament paths',activationRule:'common onset activates the prescribed neighbor network',energyCoupling,maxTargetStressMPa:p.maxTargetStressMPa,onsetTime,maxDeltaBefore:peak*loadAtHold,maxDeltaAtMaxLoad:peak,peakPoint,seeds,paths,probe,loadAtHold};
  let sampledMaxStressDifferenceMPa=peak*loadAtHold/(Math.abs(p.coefficient)*p.thicknessUm*1e-3)||0;
  function scaleSample(x,y) {for(const time of [Number.isFinite(onsetTime)?onsetTime:4,10]){const v=crackSample(scenario,x,y,time);if(!v.excluded)sampledMaxStressDifferenceMPa=Math.max(sampledMaxStressDifferenceMPa,v.principalDifferenceMPa);}}
  for(let iy=0;iy<=20;iy++)for(let ix=0;ix<=30;ix++)scaleSample(d.xMin+d.width*ix/30,d.yMin+d.height*iy/20);
  // Rim samples ensure single-hole and optical-coefficient-zero stress scales
  // remain meaningful independently of the ligament optical threshold.
  for(const h of g.holes)for(let i=0;i<180;i++)scaleSample(h.x+g.radiusUm*Math.cos(TAU*i/180),h.y+g.radiusUm*Math.sin(TAU*i/180));
  for(const path of candidatePaths)for(const q of path.points)scaleSample(q.x,q.y);
  scenario.sampledMaxStressDifferenceMPa=sampledMaxStressDifferenceMPa;
  scenario.stressScaleMPa=Math.max(1,sampledMaxStressDifferenceMPa*1.15);
  scenario.retardanceScaleNm=Math.max(1,scenario.stressScaleMPa*Math.abs(p.coefficient)*p.thicknessUm*1e-3);
  scenario.scaleMethod='Sampled grid, hole rims and ligament paths, padded 15%; not a rigorous global bound.';
  return scenario;
}
function distanceToPath(x,y,points) {
  let distance=Infinity;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[i+1]||a,dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
    const t=l?clamp(((x-a.x)*dx+(y-a.y)*dy)/l,0,1):0;
    distance=Math.min(distance,Math.hypot(x-a.x-t*dx,y-a.y-t*dy));
  }
  return distance;
}
function state(s,time) {const t=clamp(finite(time,'time'),0,10),loadFraction=Math.min(t/4,s.loadAtHold),elapsed=Math.max(0,t-s.onsetTime);return {time:t,loadFraction,loadMPa:s.maxTargetStressMPa*loadFraction,laserEnergyMj:s.params.laserEnergyMj*loadFraction,maxTargetStressMPa:s.maxTargetStressMPa,cracked:t>=s.onsetTime,relaxation:Number.isFinite(elapsed)?s.params.relaxationFraction*(-Math.expm1(-elapsed/s.params.relaxationTauSec)):0};}
export function crackSample(s,xUm,yUm,time=0) {
  finite(xUm,'xUm');finite(yUm,'yUm');const st=state(s,time);
  let cache=sampleCaches.get(s);if(!cache){cache=new Map();sampleCaches.set(s,cache);}
  const key=`${xUm},${yUm}`;let entry=cache.get(key);
  if(!entry){let weight=0;for(const path of s.paths)weight=Math.max(weight,Math.exp(-((distanceToPath(xUm,yUm,path.points)/s.params.relaxationRadiusUm)**2)));entry={tensor:unitTensor(s.geometry,xUm,yUm),weight};if(cache.size<100000)cache.set(key,entry);}
  const t=entry.tensor;
  if(!t)return {excluded:true,deltaNm:null,retardanceNm:null,referenceRetardanceNm:null,fastAxisRad:null,slowAxisRad:null,fastAxisDefined:false,slowAxisDefined:false,transmission:null};
  const p=s.params;
  const weight=entry.weight;
  const relaxation=st.relaxation*weight,scale=st.loadMPa*(1-relaxation);
  const xx=t.xx*scale,yy=t.yy*scale,xy=t.xy*scale;
  const difference=Math.hypot(xx-yy,2*xy),angle=.5*Math.atan2(2*xy,xx-yy);
  const sigma1MPa=(xx+yy+difference)/2,sigma2MPa=(xx+yy-difference)/2;
  const deltaNm=Math.abs(p.coefficient)*difference*p.thicknessUm*1e-3,rawFastAxisRad=fastAngle({angle},p),phaseRad=TAU*deltaNm/p.wavelengthNm;
  // Optical axes are line directions (equivalent modulo π), not polar vectors.
  // Mask numerically negligible stress AND optical anisotropy consistently.
  const axisDefined=difference>1e-12&&deltaNm>1e-9;
  const fastAxisRad=axisDefined?rawFastAxisRad:null;
  const slowAxisRad=axisDefined?rawFastAxisRad+Math.PI/2:null;
  const referenceRetardanceNm=Math.abs(p.coefficient)*t.difference*st.loadMPa*p.thicknessUm*1e-3;
  return {excluded:false,deltaNm,retardanceNm:deltaNm,phaseRad,referenceRetardanceNm,fastAxisRad,slowAxisRad,fastAxisDefined:axisDefined,slowAxisDefined:axisDefined,principalAngleRad:angle,principalDifferenceMPa:difference,sigmaXMPa:xx,sigmaYMPa:yy,tauXYMPa:xy,sigma1MPa,sigma2MPa,maxPrincipalMPa:sigma1MPa,stressMagnitudeMPa:Math.max(Math.abs(sigma1MPa),Math.abs(sigma2MPa)),relaxation,transmission:Math.sin(2*(rawFastAxisRad-p.polarizerAngleDeg*Math.PI/180))**2*Math.sin(phaseRad/2)**2};
}
export function crackFrame(s,time) {const st=state(s,time);
  return {...st,hasNeighbor:s.hasNeighbor,status:!s.hasNeighbor?'no-neighbor':st.cracked?'connected':'loading',nearTipMaxStressMPa:null,tips:[],growthFactor:st.cracked?1:0,probe:crackSample(s,s.probe.x,s.probe.y,st.time),paths:st.cracked?s.paths:[],onsetTime:s.onsetTime};}
