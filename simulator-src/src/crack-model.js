/** User-prescribed optical crack hypothesis, NOT a fracture predictor or FEM.
 * Circular Kirsch tensors are superposed and duplicated remote tensors
 * subtracted. This is NOT the exact interacting multi-hole boundary solution.
 * Coordinates µm, stress MPa, C in Brewster (10^-12 Pa^-1), retardance nm.
 * n1-n2=C(sigma1-sigma2): C>0 makes the minor principal axis optically fast.
 * Crack paths freeze at onset; scalar local stress removal is prescribed, not
 * an equilibrated elasticity solution. Regularized Mode-I tip tensors are added
 * as a prescribed redistribution, not a computed traction-free crack solution. No toughness or growth law is inferred.
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
  p.tipCoreUm??=.035*p.diameterUm;p.tipRadiusUm??=.7*p.diameterUm;p.tipStrength??=2;
  positive(p.tipCoreUm,'tipCoreUm');positive(p.tipRadiusUm,'tipRadiusUm');positive(p.tipStrength,'tipStrength',true);
  positive(p.loadMPa,'loadMPa',true); finite(p.coefficient,'coefficient');finite(p.polarizerAngleDeg,'polarizerAngleDeg');
  finite(p.relaxationFraction,'relaxationFraction'); if(p.relaxationFraction<0||p.relaxationFraction>1) throw new RangeError('relaxationFraction must be in [0,1]');
  p.relaxationRadiusUm??=.45*p.diameterUm; p.pathLengthUm??=2*p.diameterUm;
  positive(p.relaxationRadiusUm,'relaxationRadiusUm');positive(p.pathLengthUm,'pathLengthUm');
  p.maxTargetStressMPa=finite(p.loadMPa+p.stressPerMj*p.laserEnergyMj*(500/p.thicknessUm)**p.thicknessExponent,'target stress');
  return p;
}
export function crackGeometry(input={}) {
  const p=parameters(input),radiusUm=p.diameterUm/2,offset=(p.diameterUm+p.gapUm)/2;
  const holes=p.layout==='grid'?[-1,1].flatMap(y=>[-1,1].map(x=>({x:x*offset,y:y*offset,radiusUm}))):Array.from({length:p.holeCount},(_,i)=>({x:(i-(p.holeCount-1)/2)*2*offset,y:0,radiusUm}));
  const margin=radiusUm+p.pathLengthUm+p.tipRadiusUm+p.diameterUm/70;
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
function inDomain(g,x,y) {const d=g.domain;return x>=d.xMin&&x<=d.xMax&&y>=d.yMin&&y<=d.yMax;}
function segmentSafe(g,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
  return g.holes.every(h=>{const t=l?clamp(((h.x-a.x)*dx+(h.y-a.y)*dy)/l,0,1):0;return Math.hypot(a.x+t*dx-h.x,a.y+t*dy-h.y)>=h.radiusUm*(1-1e-10);});
}
function streamline(g,p,seed) {
  const step=p.diameterUm/70,branches=[];
  for(const sign of [-1,1]) {
    let at={x:seed.x,y:seed.y},angle=fastAngle(unitTensor(g,at.x,at.y),p),prev={x:sign*Math.cos(angle),y:sign*Math.sin(angle)};
    const points=[];
    for(let i=0;i<Math.min(1400,Math.ceil(p.pathLengthUm/step));i++) {
      const tensor=unitTensor(g,at.x,at.y);if(!tensor||tensor.difference<1e-10) break;
      angle=fastAngle(tensor,p);let dx=Math.cos(angle),dy=Math.sin(angle);if(dx*prev.x+dy*prev.y<0){dx=-dx;dy=-dy;}
      const next={x:at.x+step*dx,y:at.y+step*dy};
      if(!inDomain(g,next.x,next.y)||!segmentSafe(g,at,next))break;
      if(points.length>12&&points.slice(0,-10).some(q=>Math.hypot(next.x-q.x,next.y-q.y)<step*.7))break;
      points.push(next);prev={x:dx,y:dy};at=next;
    }
    branches.push(points);
  }
  return [...branches[0].reverse(),{x:seed.x,y:seed.y},...branches[1]];
}
export function buildCrackScenario(input={}) {
  const p=parameters(input),g=crackGeometry(p);let peak=0,peakPoint=null;
  function consider(x,y) {const t=unitTensor(g,x,y);if(!t)return 0;const value=delta(t,p);if(value>peak){peak=value;peakPoint={x,y};}return value;}
  const d=g.domain;
  for(let iy=0;iy<=80;iy++)for(let ix=0;ix<=112;ix++)consider(d.xMin+d.width*ix/112,d.yMin+d.height*iy/80);
  const seeds=g.holes.map((h,holeIndex)=>{
    let best={x:h.x,y:h.y+h.radiusUm*(1+1e-9),holeIndex,deltaNm:-1};
    for(let i=0;i<720;i++){const a=TAU*i/720,x=h.x+h.radiusUm*(1+1e-9)*Math.cos(a),y=h.y+h.radiusUm*(1+1e-9)*Math.sin(a),value=consider(x,y);if(value>best.deltaNm+1e-9)best={x,y,holeIndex,deltaNm:value};}
    return best;
  });
  // If a sampled ligament point exceeds all rim peaks, it is the explicit
  // threshold seed. Never freeze loading without actually nucleating a path.
  if(peakPoint&&peak>Math.max(...seeds.map(s=>s.deltaNm))*(1+1e-6)) {
    const holeIndex=g.holes.reduce((best,h,i)=>Math.hypot(h.x-peakPoint.x,h.y-peakPoint.y)<Math.hypot(g.holes[best].x-peakPoint.x,g.holes[best].y-peakPoint.y)?i:best,0);
    seeds[holeIndex]={...peakPoint,holeIndex,deltaNm:peak,ligamentSeed:true};
  }
  finite(peak,'peak retardance');
  const onsetTime=peak>=p.thresholdNm?4*p.thresholdNm/peak:Infinity;
  const loadAtHold=Number.isFinite(onsetTime)?onsetTime/4:1;
  for(const s of seeds) {s.deltaAtMaxLoadNm=s.deltaNm;s.deltaNm*=loadAtHold;s.onsetTime=s.deltaNm>=p.thresholdNm*(1-1e-6)?onsetTime:Infinity;}
  const paths=seeds.flatMap((seed,seedIndex)=>Number.isFinite(seed.onsetTime)?[{seedIndex,onsetTime:seed.onsetTime,points:streamline(g,p,seed)}]:[]);
  const tips=paths.flatMap(path=>{
    const points=path.points,seed=seeds[path.seedIndex];if(points.length<2)return [];
    return [[points[0],points[1]],[points.at(-1),points.at(-2)]].filter(([a])=>Math.hypot(a.x-seed.x,a.y-seed.y)>p.diameterUm*.2&&g.holes.every(h=>Math.hypot(a.x-h.x,a.y-h.y)>h.radiusUm+p.tipCoreUm)).map(([a,b])=>({...a,tangentRad:Math.atan2(a.y-b.y,a.x-b.x),seedIndex:path.seedIndex}));
  });
  const energyCoupling={assumed:true,referenceThicknessUm:500,stressPerMj:p.stressPerMj,thicknessExponent:p.thicknessExponent,description:'Prescribed stress = background + κ E (500/t)^p; not a calibrated laser thermoelastic model.'};
  const scenario={params:p,geometry:g,...g,tips,energyCoupling,maxTargetStressMPa:p.maxTargetStressMPa,onsetTime,maxDeltaBefore:peak*loadAtHold,maxDeltaAtMaxLoad:peak,peakPoint,seeds,paths,probe:seeds.find(s=>Number.isFinite(s.onsetTime))||seeds[0],loadAtHold};
  let sampledMaxStressDifferenceMPa=peak*loadAtHold/(Math.abs(p.coefficient)*p.thicknessUm*1e-3)||0;
  function scaleSample(x,y) {for(const time of [Number.isFinite(onsetTime)?onsetTime:4,10]){const v=crackSample(scenario,x,y,time);if(!v.excluded)sampledMaxStressDifferenceMPa=Math.max(sampledMaxStressDifferenceMPa,v.principalDifferenceMPa);}}
  for(let iy=0;iy<=20;iy++)for(let ix=0;ix<=30;ix++)scaleSample(d.xMin+d.width*ix/30,d.yMin+d.height*iy/20);
  for(const tip of tips)for(const r of [0,p.tipCoreUm,2*p.tipCoreUm,4*p.tipCoreUm,p.tipRadiusUm*.5])for(let i=0;i<32;i++)scaleSample(tip.x+r*Math.cos(TAU*i/32),tip.y+r*Math.sin(TAU*i/32));
  scenario.sampledMaxStressDifferenceMPa=sampledMaxStressDifferenceMPa;
  scenario.stressScaleMPa=Math.max(1,sampledMaxStressDifferenceMPa*1.15);
  scenario.retardanceScaleNm=Math.max(1,scenario.stressScaleMPa*Math.abs(p.coefficient)*p.thicknessUm*1e-3);
  scenario.scaleMethod='Sampled pre/post-crack grid and tip rings, padded 15%; not a rigorous global bound.';
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
// Regularized Mode-I angular tensor in each outward tip's local coordinates.
// Compact support and a seed guard preserve remote stress and seed unloading.
function tipTensor(s,x,y) {
  const p=s.params;let xx=0,yy=0,xy=0;
  let guard=1;for(const seed of s.seeds)guard=Math.min(guard,clamp((Math.hypot(x-seed.x,y-seed.y)-p.diameterUm*.15)/(p.diameterUm*.15),0,1));
  for(const tip of s.tips) {
    const c=Math.cos(tip.tangentRad),sn=Math.sin(tip.tangentRad),dx=x-tip.x,dy=y-tip.y;
    const u=dx*c+dy*sn,v=-dx*sn+dy*c,r=Math.hypot(u,v);if(r>=p.tipRadiusUm)continue;
    const a=Math.atan2(v,u),ch=Math.cos(a/2),sh=Math.sin(a/2),s3=Math.sin(1.5*a),c3=Math.cos(1.5*a);
    const amplitude=guard*p.tipStrength*Math.sqrt(p.diameterUm/(2*Math.hypot(r,p.tipCoreUm)))*(1-(r/p.tipRadiusUm)**2)**2;
    const tx=amplitude*ch*(1-sh*s3),ty=amplitude*ch*(1+sh*s3),txy=amplitude*ch*sh*c3;
    xx+=tx*c*c+ty*sn*sn-2*txy*sn*c;yy+=tx*sn*sn+ty*c*c+2*txy*sn*c;xy+=(tx-ty)*sn*c+txy*(c*c-sn*sn);
  }
  return {xx,yy,xy};
}
export function crackSample(s,xUm,yUm,time=0) {
  finite(xUm,'xUm');finite(yUm,'yUm');const st=state(s,time);
  let cache=sampleCaches.get(s);if(!cache){cache=new Map();sampleCaches.set(s,cache);}
  const key=`${xUm},${yUm}`;let entry=cache.get(key);
  if(!entry){let weight=0;for(const path of s.paths)weight=Math.max(weight,Math.exp(-((distanceToPath(xUm,yUm,path.points)/s.params.relaxationRadiusUm)**2)));entry={tensor:unitTensor(s.geometry,xUm,yUm),tip:tipTensor(s,xUm,yUm),weight};if(cache.size<100000)cache.set(key,entry);}
  const t=entry.tensor;
  if(!t)return {excluded:true,deltaNm:null,retardanceNm:null,referenceRetardanceNm:null,fastAxisRad:null,slowAxisRad:null,fastAxisDefined:false,slowAxisDefined:false,transmission:null};
  const p=s.params;
  const weight=entry.weight;
  const relaxation=st.relaxation*weight,scale=st.loadMPa*(1-relaxation),tipScale=st.loadMPa*st.relaxation;
  const xx=t.xx*scale+entry.tip.xx*tipScale,yy=t.yy*scale+entry.tip.yy*tipScale,xy=t.xy*scale+entry.tip.xy*tipScale;
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
  let nearTipMaxStressMPa=0;
  if(st.cracked)for(const tip of s.tips)for(const r of [0,s.params.tipCoreUm,2*s.params.tipCoreUm])for(let i=0;i<12;i++) {
    const v=crackSample(s,tip.x+r*Math.cos(TAU*i/12),tip.y+r*Math.sin(TAU*i/12),st.time);
    if(!v.excluded)nearTipMaxStressMPa=Math.max(nearTipMaxStressMPa,v.sigma1MPa);
  }
  return {...st,nearTipMaxStressMPa,tips:st.cracked?s.tips:[],growthFactor:st.cracked?1:0,probe:crackSample(s,s.probe.x,s.probe.y,st.time),paths:st.cracked?s.paths:[],onsetTime:s.onsetTime};}
