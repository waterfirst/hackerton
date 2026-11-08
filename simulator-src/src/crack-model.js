/** User-prescribed optical crack hypothesis, NOT a fracture predictor or FEM.
 * Circular Kirsch tensors are superposed and duplicated remote tensors
 * subtracted. This is NOT the exact interacting multi-hole boundary solution.
 * Coordinates µm, stress MPa, C in Brewster (10^-12 Pa^-1), retardance nm.
 * n1-n2=C(sigma1-sigma2): C>0 makes the minor principal axis optically fast.
 * Curved nearest-neighbor rim connections are prescribed from the user's
 * reference, NOT fast-axis streamlines or predicted propagation trajectories.
 * One sampled ligament threshold starts the prescribed neighbor network.
 * Each path seeds at its intact maximum principal-stress difference. Two
 * fronts advance along that fixed path, faster where intact Δσ is higher.
 * This is conceptual sequencing, NOT a validated fracture-growth law.
 * A seed on a rim has one front already complete; it is not moved inward.
 * A broad prescribed Gaussian tensor multiplier illustrates high retardance
 * near candidate connectors. A narrower core releases after local front arrival.
 * This observation-inspired band is NOT measured reconstruction or equilibrium.
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
  const p={bandStrength:1.5,holeCount:2,layout:'row',laserEnergyMj:0,stressPerMj:10,thicknessExponent:2,diameterUm:120,gapUm:120,loadMPa:60,coefficient:3,thicknessUm:500,wavelengthNm:550,polarizerAngleDeg:0,thresholdNm:150,relaxationFraction:.8,relaxationTauSec:.8,propagationDurationSec:2,...input};
  for(const k of ['diameterUm','gapUm','thicknessUm','wavelengthNm','thresholdNm','relaxationTauSec']) positive(p[k],k);
  if(!Number.isInteger(p.holeCount)||p.holeCount<1||p.holeCount>4)throw new RangeError('holeCount must be 1..4');
  if(!['row','grid'].includes(p.layout)||(p.layout==='grid'&&p.holeCount!==4))throw new RangeError('grid layout requires four holes');
  for(const k of ['laserEnergyMj','stressPerMj'])positive(p[k],k,true);
  positive(p.thicknessExponent,'thicknessExponent');if(p.thicknessExponent<=1)throw new RangeError('thicknessExponent must exceed one');
  positive(p.loadMPa,'loadMPa',true); finite(p.coefficient,'coefficient');finite(p.polarizerAngleDeg,'polarizerAngleDeg');
  finite(p.relaxationFraction,'relaxationFraction'); if(p.relaxationFraction<0||p.relaxationFraction>1) throw new RangeError('relaxationFraction must be in [0,1]');
  finite(p.propagationDurationSec,'propagationDurationSec');if(p.propagationDurationSec<.2||p.propagationDurationSec>5)throw new RangeError('propagationDurationSec must be in [0.2,5]');
  p.relaxationRadiusUm??=.08*p.diameterUm; p.bandWidthUm??=.22*p.diameterUm;
  positive(p.bandStrength,'bandStrength',true);positive(p.bandWidthUm,'bandWidthUm');
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
/** Ideal monochromatic crossed-polarizer intensity, I/I0. No display exposure
 * or contrast is applied here: high retardance can still be an extinction.
 */
export function crossedPolarizerTransmission(retardanceNm,wavelengthNm,fastAxisRad,polarizerAngleDeg=0) {
  positive(retardanceNm,'retardanceNm',true);positive(wavelengthNm,'wavelengthNm');finite(fastAxisRad,'fastAxisRad');finite(polarizerAngleDeg,'polarizerAngleDeg');
  return Math.sin(2*(fastAxisRad-polarizerAngleDeg*Math.PI/180))**2*Math.sin(Math.PI*retardanceNm/wavelengthNm)**2;
}
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
/** Stress only ranks speed ALONG an already prescribed connector. Per segment,
 * w=0.25+0.75*mean(Δσ endpoints)/max(Δσ on this path). Travel cost is ds/w.
 * One common speed multiplier per path makes its slower side finish at the
 * requested duration; the other front may reach its rim earlier. No toughness,
 * energy release rate, principal-axis steering or free-tip field is inferred.
 */
function growthProfile(g,p,path,edgeIndex) {
  const stresses=path.points.map(q=>unitTensor(g,q.x,q.y).difference*p.maxTargetStressMPa*(1+p.bandStrength));
  const peak=Math.max(...stresses),seedPointIndex=stresses.indexOf(peak);
  const pointSpeedWeights=stresses.map(value=>peak>0?.25+.75*value/peak:1);
  const arcLengthsUm=[0],travelCoordinates=[0],segmentSpeedWeights=[];
  for(let i=1;i<path.points.length;i++) {
    const a=path.points[i-1],b=path.points[i],length=Math.hypot(b.x-a.x,b.y-a.y),weight=(pointSpeedWeights[i-1]+pointSpeedWeights[i])/2;
    arcLengthsUm.push(arcLengthsUm[i-1]+length);travelCoordinates.push(travelCoordinates[i-1]+length/weight);segmentSpeedWeights.push(weight);
  }
  const seedTravel=travelCoordinates[seedPointIndex],maxTravel=Math.max(seedTravel,travelCoordinates.at(-1)-seedTravel),speedScaleUmPerSec=maxTravel/p.propagationDurationSec;
  return {edgeIndex,seedPointIndex,seedDistanceUm:arcLengthsUm[seedPointIndex],totalLengthUm:arcLengthsUm.at(-1),arcLengthsUm,travelCoordinates,pointSpeedWeights,segmentSpeedWeights,segmentSpeedUmPerSec:segmentSpeedWeights.map(w=>w*speedScaleUmPerSec),principalDifferenceAtMaxLoadMPa:stresses,arrivalDelaysSec:travelCoordinates.map(value=>Math.abs(value-seedTravel)/speedScaleUmPerSec),seedTravel,speedScaleUmPerSec};
}
export function buildCrackScenario(input={}) {
  const p=parameters(input),g=crackGeometry(p),d=g.domain;
  const edges=p.layout==='grid'?[[0,1],[2,3],[0,2],[1,3]]:Array.from({length:p.holeCount-1},(_,i)=>[i,i+1]);
  const candidatePaths=edges.map(([a,b])=>connector(g,a,b));
  const growthProfiles=candidatePaths.map((path,i)=>growthProfile(g,p,path,i));
  let peak=0,peakPoint=null;
  const seeds=candidatePaths.map((path,seedIndex)=>{
    const profile=growthProfiles[seedIndex],pathPointIndex=profile.seedPointIndex,stressAtMaxLoadMPa=profile.principalDifferenceAtMaxLoadMPa[pathPointIndex];
    const best={...path.points[pathPointIndex],deltaNm:stressAtMaxLoadMPa*Math.abs(p.coefficient)*p.thicknessUm*1e-3,pathPointIndex,stressAtMaxLoadMPa};
    if(best.deltaNm>peak||peakPoint===null){peak=best.deltaNm;peakPoint={x:best.x,y:best.y};}
    return {...best,holeIndex:path.fromHoleIndex,edgeIndex:seedIndex,seedIndex,ligamentSeed:true};
  });
  finite(peak,'peak retardance');
  const hasNeighbor=edges.length>0;
  const onsetTime=hasNeighbor&&peak>=p.thresholdNm?4*p.thresholdNm/peak:Infinity;
  const loadAtHold=Number.isFinite(onsetTime)?onsetTime/4:1;
  for(const seed of seeds){seed.deltaAtMaxLoadNm=seed.deltaNm;seed.deltaNm*=loadAtHold;seed.principalDifferenceMPa=seed.stressAtMaxLoadMPa*loadAtHold;seed.onsetTime=onsetTime;seed.locallyReachedThreshold=seed.deltaNm>=p.thresholdNm*(1-1e-6);}
  for(const profile of growthProfiles)profile.preReleasePrincipalDifferenceMPa=profile.principalDifferenceAtMaxLoadMPa.map(value=>value*loadAtHold);
  const paths=Number.isFinite(onsetTime)?candidatePaths.map((path,seedIndex)=>({...path,seedIndex,onsetTime})):[];
  // A connection ending at a hole rim has no free crack tip.
  const tips=[];
  const fallbackProbe={x:g.holes[0].x,y:g.holes[0].y+g.radiusUm,holeIndex:0};
  const probe=seeds.reduce((best,s)=>!best||s.deltaNm>best.deltaNm?s:best,null)||fallbackProbe;
  const flankProbe=findFlankProbe(g,p,candidatePaths,probe);
  const bandModel={assumed:true,description:'관찰 설명용 가정 띠, 실측 재현·평형해 아님',strength:p.bandStrength,widthUm:p.bandWidthUm,releaseRadiusUm:p.relaxationRadiusUm};
  const energyCoupling={assumed:true,referenceThicknessUm:500,stressPerMj:p.stressPerMj,thicknessExponent:p.thicknessExponent,description:'Prescribed stress = background + κ E (500/t)^p; not a calibrated laser thermoelastic model.'};
  const propagationModel={assumed:true,durationSec:p.propagationDurationSec,minimumSpeedWeight:.25,description:'Conceptual stress-guided sequencing on fixed nearest-neighbor rim paths, not a validated fracture law. Seed at each path maximum intact Δσ; segment speed weight = 0.25 + 0.75 × mean endpoint Δσ / path peak Δσ. Per-path normalization makes the last front reach a rim at the requested duration. A seed on a rim has one front already complete. No toughness, energy release rate, steering or tip singularity.',relaxationRule:'Nearest projection onto each candidate path is cached geometrically. That local core starts relaxing only after its front-arrival time; overlapping cores use the largest local release, without summing.'};
  const scenario={params:p,bandModel,propagationModel,growthProfiles,flankProbe,shoulderProbe:flankProbe,geometry:g,...g,tips,edges,candidatePaths,hasNeighbor,status:!hasNeighbor?'no-neighbor':Number.isFinite(onsetTime)?'threshold-reached':'below-threshold',thresholdBasis:'maximum along prescribed ligament paths',activationRule:'common onset starts stress-weighted growth along the prescribed neighbor network',energyCoupling,maxTargetStressMPa:p.maxTargetStressMPa,onsetTime,maxDeltaBefore:peak*loadAtHold,maxDeltaAtMaxLoad:peak,peakPoint,seeds,paths,probe,loadAtHold};
  let sampledMaxStressDifferenceMPa=peak*loadAtHold/(Math.abs(p.coefficient)*p.thicknessUm*1e-3)||0;
  function scaleSample(x,y) {for(const time of [Number.isFinite(onsetTime)?onsetTime:4,10]){const v=crackSample(scenario,x,y,time);if(!v.excluded)sampledMaxStressDifferenceMPa=Math.max(sampledMaxStressDifferenceMPa,v.referencePrincipalDifferenceMPa);}}
  for(let iy=0;iy<=20;iy++)for(let ix=0;ix<=30;ix++)scaleSample(d.xMin+d.width*ix/30,d.yMin+d.height*iy/20);
  // Rim samples ensure single-hole and optical-coefficient-zero stress scales
  // remain meaningful independently of the ligament optical threshold.
  for(const h of g.holes)for(let i=0;i<180;i++)scaleSample(h.x+g.radiusUm*Math.cos(TAU*i/180),h.y+g.radiusUm*Math.sin(TAU*i/180));
  for(const path of candidatePaths)for(const q of path.points)scaleSample(q.x,q.y);
  scenario.sampledMaxStressDifferenceMPa=sampledMaxStressDifferenceMPa;
  scenario.stressScaleMPa=Math.max(1,sampledMaxStressDifferenceMPa*1.15);
  scenario.retardanceScaleNm=Math.max(1,scenario.stressScaleMPa*Math.abs(p.coefficient)*p.thicknessUm*1e-3);
  scenario.scaleMethod='Same-held-load no-relaxation reference sampled on grid, hole rims and ligament paths, padded 15%; not a rigorous global bound.';
  return scenario;
}
function nearestPathLocation(x,y,points) {
  let distanceSquared=Infinity,segmentIndex=0,fraction=0;
  for(let i=0;i<points.length-1;i++) {
    const a=points[i],b=points[i+1],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
    const t=l?clamp(((x-a.x)*dx+(y-a.y)*dy)/l,0,1):0;
    const ds=(x-a.x-t*dx)**2+(y-a.y-t*dy)**2;
    if(ds<distanceSquared){distanceSquared=ds;segmentIndex=i;fraction=t;}
  }
  return {distanceSquared,segmentIndex,fraction};
}
function distanceToPath(x,y,points) {return Math.sqrt(nearestPathLocation(x,y,points).distanceSquared);}
function interpolateLocation(points,coordinates,value) {
  let lo=0,hi=coordinates.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(coordinates[mid]<value)lo=mid;else hi=mid;}
  const fraction=clamp((value-coordinates[lo])/(coordinates[hi]-coordinates[lo]),0,1),a=points[lo],b=points[hi];
  return {x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction,index:lo,fraction};
}
function grownPath(s,path,elapsedSec) {
  const profile=s.growthProfiles[path.seedIndex],coordinates=profile.travelCoordinates;
  const finished=elapsedSec>=s.params.propagationDurationSec-1e-12;
  const travel=finished?coordinates.at(-1):Math.max(0,elapsedSec)*profile.speedScaleUmPerSec;
  const startTravel=Math.max(0,profile.seedTravel-travel),endTravel=Math.min(coordinates.at(-1),profile.seedTravel+travel);
  const a=interpolateLocation(path.points,coordinates,startTravel),b=interpolateLocation(path.points,coordinates,endTravel);
  const distance=q=>profile.arcLengthsUm[q.index]+q.fraction*(profile.arcLengthsUm[q.index+1]-profile.arcLengthsUm[q.index]);
  const startDistanceUm=distance(a),endDistanceUm=distance(b),grownLengthUm=endDistanceUm-startDistanceUm;
  const points=[{x:a.x,y:a.y}];
  for(let i=a.index+1;i<=b.index;i++)if(coordinates[i]>startTravel&&coordinates[i]<endTravel)points.push(path.points[i]);
  points.push({x:b.x,y:b.y});
  const complete=startTravel===0&&endTravel===coordinates.at(-1),progress=clamp(grownLengthUm/profile.totalLengthUm,0,1);
  // At onset the zero-length seed is represented by two equal points, never by
  // a premature full connector. Fronts are display markers, NOT free crack tips.
  return {...path,points,seedPointIndex:profile.seedPointIndex,seedPoint:path.points[profile.seedPointIndex],seedDistanceUm:profile.seedDistanceUm,startDistanceUm,endDistanceUm,grownLengthUm,totalLengthUm:profile.totalLengthUm,progress,growthFraction:progress,complete,fronts:[{x:a.x,y:a.y,edgeIndex:path.seedIndex,side:'start',atRim:startTravel===0,active:startTravel>0},{x:b.x,y:b.y,edgeIndex:path.seedIndex,side:'end',atRim:endTravel===coordinates.at(-1),active:endTravel<coordinates.at(-1)}]};
}
function state(s,time) {const t=clamp(finite(time,'time'),0,10),loadFraction=Math.min(t/4,s.loadAtHold),elapsed=Math.max(0,t-s.onsetTime);return {time:t,loadFraction,loadMPa:s.maxTargetStressMPa*loadFraction,laserEnergyMj:s.params.laserEnergyMj*loadFraction,maxTargetStressMPa:s.maxTargetStressMPa,cracked:t>=s.onsetTime,relaxation:Number.isFinite(elapsed)?s.params.relaxationFraction*(-Math.expm1(-elapsed/s.params.relaxationTauSec)):0};}
function findFlankProbe(g,p,paths,probe) {
  if(!paths.length)return null;
  const edgeIndex=probe.edgeIndex??0,path=paths[edgeIndex],target=.65*p.bandWidthUm;
  const nearest=path.points.reduce((best,q,i)=>Math.hypot(q.x-probe.x,q.y-probe.y)<Math.hypot(path.points[best].x-probe.x,path.points[best].y-probe.y)?i:best,0);
  let best=null,bestScore=Infinity;
  // Q is a fixed geometric offset near threshold probe P, not a stress maximum.
  // Try nearby segment normals and either side; avoid hole interiors. Selection
  // uses distance only and does not enforce Q > P in any optical field.
  for(const offset of [0,-1,1,-2,2,-4,4,-8,8]) {
    const i=clamp(nearest+offset,0,path.points.length-1),q=path.points[i],a=path.points[Math.max(0,i-1)],b=path.points[Math.min(path.points.length-1,i+1)],len=Math.hypot(b.x-a.x,b.y-a.y);
    for(const factor of [1,.75,.5,.25])for(const sign of [1,-1]) {
      const x=q.x-sign*(b.y-a.y)/len*target*factor,y=q.y+sign*(b.x-a.x)/len*target*factor;
      if(!unitTensor(g,x,y))continue;
      const distance=Math.min(...paths.map(path=>distanceToPath(x,y,path.points)));
      const score=Math.abs(distance-target)/target+Math.abs(offset)*.001;
      if(score<bestScore){bestScore=score;best={x,y,edgeIndex,distanceToPathUm:distance,distanceToProbeUm:Math.hypot(x-probe.x,y-probe.y),selection:'geometric normal offset near P; not a field-maximum search'};}
    }
  }
  return best;
}
export function crackSample(s,xUm,yUm,time=0,{view='current'}={}) {
  if(!['current','reference','base'].includes(view))throw new RangeError('view must be current, reference or base');
  finite(xUm,'xUm');finite(yUm,'yUm');const st=state(s,time);
  let cache=sampleCaches.get(s);if(!cache){cache=new Map();sampleCaches.set(s,cache);}
  const key=`${xUm},${yUm}`;let entry=cache.get(key);
  if(!entry){
    let distanceSquared=Infinity,nearestArrivalDelaySec=null;
    const localCores=s.candidatePaths.map((path,i)=>{
      const location=nearestPathLocation(xUm,yUm,path.points),delays=s.growthProfiles[i].arrivalDelaysSec;
      const arrivalDelaySec=delays[location.segmentIndex]+location.fraction*(delays[location.segmentIndex+1]-delays[location.segmentIndex]);
      if(location.distanceSquared<distanceSquared){distanceSquared=location.distanceSquared;nearestArrivalDelaySec=arrivalDelaySec;}
      return {arrivalDelaySec,weight:Math.exp(-location.distanceSquared/s.params.relaxationRadiusUm**2)};
    });
    const bandWeight=Math.exp(-distanceSquared/s.params.bandWidthUm**2);
    // Geometry and local arrival delays are time independent. Never cache a
    // frame's release amount: seeking backward must restore the intact field.
    entry={tensor:unitTensor(s.geometry,xUm,yUm),localCores,nearestArrivalDelaySec,bandWeight};if(cache.size<100000)cache.set(key,entry);
  }
  const t=entry.tensor;
  if(!t)return {excluded:true,deltaNm:null,retardanceNm:null,referenceRetardanceNm:null,baseRetardanceNm:null,referencePrincipalDifferenceMPa:null,basePrincipalDifferenceMPa:null,fastAxisRad:null,slowAxisRad:null,fastAxisDefined:false,slowAxisDefined:false,transmission:null};
  const p=s.params;
  let localRelaxation=0;
  if(st.cracked)for(const core of entry.localCores){const elapsed=st.time-s.onsetTime-core.arrivalDelaySec;if(elapsed>0)localRelaxation=Math.max(localRelaxation,p.relaxationFraction*(-Math.expm1(-elapsed/p.relaxationTauSec))*core.weight);}
  const localArrivalTimeSec=Number.isFinite(s.onsetTime)&&entry.nearestArrivalDelaySec!==null?s.onsetTime+entry.nearestArrivalDelaySec:null;
  const relaxation=view==='current'?localRelaxation:0;
  const bandFactor=1+p.bandStrength*entry.bandWeight;
  const scale=st.loadMPa*(view==='base'?1:bandFactor)*(1-relaxation);
  const xx=t.xx*scale,yy=t.yy*scale,xy=t.xy*scale;
  const difference=Math.hypot(xx-yy,2*xy),angle=.5*Math.atan2(2*xy,xx-yy);
  const sigma1MPa=(xx+yy+difference)/2,sigma2MPa=(xx+yy-difference)/2;
  const deltaNm=Math.abs(p.coefficient)*difference*p.thicknessUm*1e-3,rawFastAxisRad=fastAngle({angle},p),phaseRad=TAU*deltaNm/p.wavelengthNm;
  // Optical axes are line directions (equivalent modulo π), not polar vectors.
  // Mask numerically negligible stress AND optical anisotropy consistently.
  const axisDefined=difference>1e-12&&deltaNm>1e-9;
  const fastAxisRad=axisDefined?rawFastAxisRad:null;
  const slowAxisRad=axisDefined?rawFastAxisRad+Math.PI/2:null;
  const basePrincipalDifferenceMPa=t.difference*st.loadMPa;
  const referencePrincipalDifferenceMPa=basePrincipalDifferenceMPa*bandFactor;
  const baseRetardanceNm=Math.abs(p.coefficient)*basePrincipalDifferenceMPa*p.thicknessUm*1e-3;
  const referenceRetardanceNm=baseRetardanceNm*bandFactor;
  return {excluded:false,view,bandFactor,bandWeight:entry.bandWeight,localRelaxation,localArrivalTimeSec,localGrowthReached:localArrivalTimeSec!==null&&st.time>=localArrivalTimeSec,baseRetardanceNm,basePrincipalDifferenceMPa,referencePrincipalDifferenceMPa,deltaNm,retardanceNm:deltaNm,phaseRad,referenceRetardanceNm,fastAxisRad,slowAxisRad,fastAxisDefined:axisDefined,slowAxisDefined:axisDefined,principalAngleRad:angle,principalDifferenceMPa:difference,sigmaXMPa:xx,sigmaYMPa:yy,tauXYMPa:xy,sigma1MPa,sigma2MPa,maxPrincipalMPa:sigma1MPa,stressMagnitudeMPa:Math.max(Math.abs(sigma1MPa),Math.abs(sigma2MPa)),relaxation,transmission:crossedPolarizerTransmission(deltaNm,p.wavelengthNm,rawFastAxisRad,p.polarizerAngleDeg)};
}
/** Same held load and topology as current sample; does not recompute onset. */
export function crackReferenceSample(s,xUm,yUm,time=0) {return crackSample(s,xUm,yUm,time,{view:'reference'});}
export function crackFrame(s,time) {const st=state(s,time);
  const paths=st.cracked?s.paths.map(path=>grownPath(s,path,st.time-s.onsetTime)):[];
  const totalLengthUm=s.growthProfiles.reduce((sum,p)=>sum+p.totalLengthUm,0),grownLengthUm=paths.reduce((sum,p)=>sum+p.grownLengthUm,0),growthFactor=totalLengthUm?clamp(grownLengthUm/totalLengthUm,0,1):0;
  const completedPathCount=paths.filter(path=>path.complete).length,connected=paths.length>0&&completedPathCount===s.paths.length;
  return {...st,hasNeighbor:s.hasNeighbor,status:!s.hasNeighbor?'no-neighbor':connected?'connected':st.cracked?'propagating':'loading',connected,nearTipMaxStressMPa:null,tips:[],fronts:paths.flatMap(path=>path.fronts),growthFactor,grownLengthUm,totalLengthUm,completedPathCount,propagationElapsedSec:st.cracked?Math.max(0,st.time-s.onsetTime):0,propagationDurationSec:s.params.propagationDurationSec,probe:crackSample(s,s.probe.x,s.probe.y,st.time),flankProbe:s.flankProbe?crackSample(s,s.flankProbe.x,s.flankProbe.y,st.time):null,shoulderProbe:s.flankProbe?crackSample(s,s.flankProbe.x,s.flankProbe.y,st.time):null,paths,onsetTime:s.onsetTime};}
