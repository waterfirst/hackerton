import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {processState, sceneGeometry, opticalSample} from './twin-model.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const defaults = {mode:'process', progress:0, thicknessUm:500, diameterUm:100, gapUm:120, holeCount:2, layout:'row',
  depthUm:30, compressionMPa:400, loadMPa:20, coefficient:3.5, wavelengthNm:550,
  polarizerAngleDeg:0, cutaway:false, rotate:false, motion:true, visible:true,
  probeAngleDeg:90, probeRadiusOverA:1.5, reducedMotion:false, storyCamera:false};

// One storyboard second, not a physical process-time prediction.
export const STORYBOARD_CAMERA_KEYS=Object.freeze([
  {progress:0,azimuthDeg:-60,elevationDeg:60,targetZOverHeight:.2,zoom:.95},
  {progress:.18,azimuthDeg:-70,elevationDeg:45,targetZOverHeight:.1,zoom:.8},
  {progress:.42,azimuthDeg:-85,elevationDeg:20,targetZOverHeight:0,zoom:.85},
  {progress:.62,azimuthDeg:-90,elevationDeg:8,targetZOverHeight:-.25,zoom:.9},
  {progress:.72,azimuthDeg:-90,elevationDeg:15,targetZOverHeight:-.2,zoom:.85},
  {progress:1,azimuthDeg:-60,elevationDeg:35,targetZOverHeight:0,zoom:1},
].map(Object.freeze));
export function storyboardCameraPose(progress) {
  if(!Number.isFinite(progress)) throw new RangeError('Storyboard progress must be finite');
  const p=clamp(progress), keys=STORYBOARD_CAMERA_KEYS;
  const end=keys.findIndex(k=>k.progress>=p);
  const b=keys[end], a=keys[Math.max(0,end-1)];
  const t=a===b?0:(p-a.progress)/(b.progress-a.progress), eased=t*t*(3-2*t);
  const pose={progress:p};
  for(const key of ['azimuthDeg','elevationDeg','targetZOverHeight','zoom']) pose[key]=a[key]+(b[key]-a[key])*eased;
  return pose;
}

// XY is the plate plane; +Z is its top. Every dimension uses one common scale.
export function plateShape(half, radius, cutaway, hole = true, centers = [{x:0,y:0}]) {
  const s = new THREE.Shape();
  if (cutaway) {
    s.moveTo(-half, 0);
    if (hole) for (const {x} of centers.filter(c=>c.y===0).sort((a,b)=>a.x-b.x)) {
      s.lineTo(x-radius, 0);
      s.absarc(x, 0, radius, Math.PI, 0, true);
    }
    s.lineTo(half, 0); s.lineTo(half, half); s.lineTo(-half, half); s.closePath();
  } else {
    s.moveTo(-half,-half); s.lineTo(half,-half); s.lineTo(half,half); s.lineTo(-half,half); s.closePath();
  }
  if (hole) for (const {x,y} of centers.filter(c=>!cutaway || c.y>radius)) {
    const p = new THREE.Path(); p.absarc(x,y,radius,0,Math.PI*2,true); s.holes.push(p);
  }
  return s;
}
export function diskShape(radius, half) {
  const s = new THREE.Shape();
  if (half) { s.moveTo(-radius,0); s.absarc(0,0,radius,Math.PI,0,true); s.closePath(); }
  else s.absarc(0,0,radius,0,Math.PI*2,false);
  return s;
}
export function extrusion(shape) {
  return new THREE.ExtrudeGeometry(shape, {depth:1, bevelEnabled:false, curveSegments:80, steps:1});
}
// Remove only cylindrical interfaces between still-connected glass volumes.
// The exposed drilled wall is rendered separately at its actual depth.
export function cylinderSurfaceSubset(source, radius, curved, centers = [{x:0,y:0}]) {
  const g=source.clone(), p=g.attributes.position, n=g.attributes.normal, indices=[];
  for(let i=0;i<p.count;i+=3) {
    const wall=[0,1,2].every(j=>Math.abs(n.getZ(i+j))<1e-6 &&
      centers.some(({x,y})=>Math.abs(Math.hypot(p.getX(i+j)-x,p.getY(i+j)-y)-radius)<1e-5));
    if(wall===curved) indices.push(i,i+1,i+2);
  }
  g.clearGroups();g.setIndex(indices);return g;
}
// Pure transform data used by the renderer and geometry regression tests.
export function twinLayout(input) {
  const s={...defaults,...input}, dimensions=sceneGeometry(s);
  const width=s.mode==='optical'?4*s.diameterUm:s.mode==='stress'?Math.max(6*s.diameterUm,1.4*s.thicknessUm):dimensions.plateWidthUm;
  const unit=6/width, height=s.thicknessUm*unit, radius=s.diameterUm*.5*unit;
  const p=s.process || processState(s.progress);
  const drill=s.mode==='optical'?1:s.mode==='stress'?0:clamp(p.drillFraction);
  const fill=s.mode==='process'?clamp(p.fillFraction):0;
  const depth=s.depthUm*unit*(s.mode==='process'?clamp(p.strengthening):1);
  const centers=s.mode==='process'?dimensions.centersUm.map(({x,y})=>({x:x*unit,y:y*unit})):s.mode==='optical'?[{x:0,y:0}]:[];
  const visibleVias=centers.filter(c=>!s.cutaway || c.y>=0).map(c=>({...c,half:s.cutaway && c.y===0}));
  return {unit,height,radius,centers,visibleVias,drill,fill,depth,remaining:height*(1-drill),
    bottom:-height/2,copperHeight:height*fill};
}
function release(group) {
  const geometry = new Set(), materials = new Set();
  group.traverse(o => {if(o.geometry) geometry.add(o.geometry); if(o.material) (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});
  geometry.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose()); group.clear();
}

export function createTwinScene(container, {onError = () => {}, onInteraction = () => {}} = {}) {
  let renderer, controls, observer, frame = 0, disposed = false, failed = false;
  let cameraView = 'perspective';
  let state = {...defaults}, geometryKey = '', refs = {}, previousTime = 0;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#07121e');
  const camera = new THREE.PerspectiveCamera(36,1,.02,150); camera.up.set(0,0,1);
  const world = new THREE.Group(); scene.add(world);
  const specimen = new THREE.Group(); world.add(specimen);
  const textureCache = new Map();
  const fail = error => {
    if(failed || disposed) return;
    failed = true; cancelAnimationFrame(frame); frame=0;
    onError(error instanceof Error ? error : new Error('3D rendering is unavailable.'));
  };
  const contextLost = event => {event.preventDefault(); fail(new Error('WebGL context lost. Use the accessible 2D fallback.'));};
  function render() {
    if(disposed || failed || !state.visible || document.hidden) return;
    try {renderer.render(scene,camera);} catch(error) {fail(error);}
  }
  function animate(time) {
    frame=0;
    if(!shouldRotate()) return;
    const dt = previousTime ? Math.min((time-previousTime)/1000,.05) : 0;
    previousTime=time;
    const p = camera.position.clone().sub(controls.target);
    p.applyAxisAngle(new THREE.Vector3(0,0,1),dt*.13);
    camera.position.copy(controls.target).add(p); controls.update();
    if(shouldRotate()) frame=requestAnimationFrame(animate);
  }
  function shouldRotate() {return !disposed && !failed && state.rotate && !(state.mode==='process' && state.storyCamera) && state.motion && state.visible && !state.reducedMotion && !document.hidden;}
  function syncAnimation() {
    if(shouldRotate()) {if(!frame) {previousTime=0; frame=requestAnimationFrame(animate);}}
    else {cancelAnimationFrame(frame); frame=0; previousTime=0;}
  }
  function visibilityChanged() {syncAnimation();render();}
  function resetView() {setView(state.mode==='optical'?'top':'perspective');}
  function setView(view) {
    if(!controls || disposed || failed) return;
    if(view==='zoomIn' || view==='zoomOut') {const direction=camera.position.clone().sub(controls.target);const factor=view==='zoomIn'?.8:1.25;direction.setLength(clamp(direction.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(direction);controls.update();render();return;}
    cameraView=view;
    const height=refs.height || 2;
    const halfFov=Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect));
    // Top view frames the normalized XY map, independent of optical path length.
    const distance=view==='top'?3.6/Math.tan(halfFov):1.12*Math.hypot(3,3,height/2)/Math.sin(halfFov);
    controls.maxDistance=Math.max(35,height*5,distance*3);
    controls.target.set(0,state.cutaway ? .55 : 0,view==='top'?height/2:0);
    const directions={top:[0,-.001,1],front:[0,-1,.02],side:[1,0,.02],section:[0,-1,.32],perspective:[.75,-1,.82],iso:[.75,-1,.82]};
    camera.position.fromArray(directions[view] || directions.perspective).normalize().multiplyScalar(distance).add(controls.target);
    controls.update(); render();
  }
  function applyStoryboardCamera() {
    if(state.mode!=='process' || !state.storyCamera || !refs.height) return;
    const pose=storyboardCameraPose(state.progress), height=refs.height;
    const halfFov=Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.min(1,camera.aspect));
    const fit=1.12*Math.hypot(3,3,height/2)/Math.sin(halfFov);
    const distance=Math.max(controls.minDistance,height*.65+1,fit*pose.zoom);
    const az=pose.azimuthDeg*Math.PI/180, el=pose.elevationDeg*Math.PI/180;
    controls.maxDistance=Math.max(controls.maxDistance,distance*2);
    controls.target.set(0,0,pose.targetZOverHeight*height);
    camera.position.set(Math.cos(az)*Math.cos(el),Math.sin(az)*Math.cos(el),Math.sin(el)).multiplyScalar(distance).add(controls.target);
    controls.update();
  }
  function interactionStarted() {onInteraction();}
  function resize() {
    if(disposed || failed) return;
    const w=Math.max(240,container.clientWidth), h=Math.max(240,container.clientHeight);
    const oldAspect=camera.aspect;
    camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h,false);
    if(geometryKey && camera.aspect<oldAspect*.95) setView(cameraView);
    applyStoryboardCamera();render();
  }
  try {
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1,1.5));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.NoToneMapping;
    renderer.domElement.style.cssText='display:block;width:100%;height:100%;touch-action:none';
    renderer.domElement.setAttribute('aria-label','Interactive conceptual glass digital twin. Drag to orbit. Use the visible camera buttons to zoom.');
    renderer.domElement.setAttribute('role','img');
    renderer.domElement.addEventListener('webglcontextlost',contextLost,false);
    container.appendChild(renderer.domElement);
    controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=false; controls.enablePan=false; controls.enableZoom=false; controls.minDistance=4; controls.maxDistance=35;
    controls.minPolarAngle=.015; controls.maxPolarAngle=Math.PI*.92;
    controls.addEventListener('change',render);
    controls.addEventListener('start',interactionStarted);
    scene.add(new THREE.HemisphereLight(0xc2e7ff,0x283041,2.4));
    const key=new THREE.DirectionalLight(0xf6f8ff,3.4); key.position.set(4,-4,7); scene.add(key);
    const rim=new THREE.DirectionalLight(0x42bbff,2);rim.position.set(-4,4,3);scene.add(rim);
    observer=new ResizeObserver(resize);observer.observe(container);
    document.addEventListener('visibilitychange',visibilityChanged);
    resize();
  } catch(error) {fail(error);}

  function opticalTexture(s) {
    const key=[s.loadMPa,s.coefficient,s.thicknessUm,s.wavelengthNm,s.polarizerAngleDeg].join('|');
    if(textureCache.has(key)) return textureCache.get(key);
    const n=320, data=new Uint8Array(n*n*4);
    for(let j=0;j<n;j++) for(let i=0;i<n;i++) {
      const sample=opticalSample(globalThis.GlassModels,{...s,xOverA:8*((i+.5)/n-.5),yOverA:8*((j+.5)/n-.5)});
      const k=(j*n+i)*4;
      // Pixel values represent I/I0 directly, without a false-color palette or auto-range.
      const gray=sample.excluded ? 0 : Math.round(255*sample.transmission);
      data[k]=data[k+1]=data[k+2]=gray;data[k+3]=sample.excluded?0:255;
    }
    const tex=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);
    tex.colorSpace=THREE.SRGBColorSpace;tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearFilter;tex.needsUpdate=true;
    textureCache.set(key,tex);
    if(textureCache.size>4) {const oldest=textureCache.keys().next().value;textureCache.get(oldest).dispose();textureCache.delete(oldest);}
    return tex;
  }
  function rebuild(s) {
    release(specimen);
    refs={};
    const {unit,radius,height,centers,visibleVias}=twinLayout(s), half=3;
    refs={height,radius,unit};
    const hole=s.mode!=='stress';
    const shape=plateShape(half,radius,s.cutaway,hole,centers);
    let solidGeo=extrusion(shape);
    if(s.mode==='process') {const outer=cylinderSurfaceSubset(solidGeo,radius,false,centers);solidGeo.dispose();solidGeo=outer;}
    const glass=new THREE.MeshPhysicalMaterial({color:0x9bd9ee,transparent:true,opacity:.22,roughness:.19,metalness:.02,side:THREE.DoubleSide,depthWrite:false});
    const plate=new THREE.Mesh(solidGeo,glass);plate.scale.z=height;plate.position.z=-height/2;specimen.add(plate);refs.plate=plate;
    const outlineSource=s.mode==='process'?extrusion(plateShape(half,radius,s.cutaway,false)):solidGeo;
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(outlineSource,25),new THREE.LineBasicMaterial({color:0x93d8ea,transparent:true,opacity:.52}));
    if(outlineSource!==solidGeo) outlineSource.dispose();
    edge.scale.z=height;edge.position.z=-height/2;specimen.add(edge);
    refs.vias=[];
    // Each via has an independent solid plug, exposed wall and copper fill.
    for (const {x,y,half:halfVia} of visibleVias) {
      const via={}; refs.vias.push(via);
      const add=(name,mesh)=>{mesh.position.set(x,y,0);specimen.add(mesh);via[name]=mesh;};
      const cylinder=extrusion(diskShape(radius,halfVia));
      add('holeEdge',new THREE.LineSegments(new THREE.EdgesGeometry(cylinder,25),new THREE.LineBasicMaterial({color:0xa2ecf5,transparent:true,opacity:.7})));
      const plugGeometry=cylinderSurfaceSubset(cylinder,radius,false);
      add('holeWall',new THREE.Mesh(cylinderSurfaceSubset(cylinder,radius,true),glass.clone()));
      add('plug',new THREE.Mesh(plugGeometry,glass.clone()));
      add('copper',new THREE.Mesh(cylinder,new THREE.MeshStandardMaterial({color:0xe69b62,metalness:.72,roughness:.29})));
      for(const name of ['plugTop','plugBottom']) add(name,new THREE.Mesh(plugGeometry,new THREE.MeshBasicMaterial({color:0x35e4ed,transparent:true,opacity:.32,side:THREE.DoubleSide,depthWrite:false})));
      const beam=new THREE.Mesh(new THREE.CylinderGeometry(radius*.36,radius*.36,1,24),new THREE.MeshBasicMaterial({color:0xa6f4ff,transparent:true,opacity:.3,depthWrite:false}));
      beam.rotation.x=Math.PI/2;add('beam',beam);
    }
    const layerMaterial=new THREE.MeshBasicMaterial({color:0x35e4ed,transparent:true,opacity:.32,side:THREE.DoubleSide,depthWrite:false});
    for(const name of ['top','bottom']) {const m=new THREE.Mesh(solidGeo,layerMaterial.clone());specimen.add(m);refs[name]=m;}
    const core=new THREE.Mesh(solidGeo,new THREE.MeshBasicMaterial({color:0xffa55d,transparent:true,opacity:.15,side:THREE.DoubleSide,depthWrite:false}));specimen.add(core);refs.core=core;
    layerMaterial.dispose();
    const point=new THREE.Mesh(new THREE.SphereGeometry(.055,12,8),new THREE.MeshBasicMaterial({color:0xffce71}));specimen.add(point);refs.probe=point;
    if(s.mode==='optical') {
      const surface=new THREE.ShapeGeometry(shape,80);
      const pos=surface.attributes.position, uv=surface.attributes.uv;
      for(let i=0;i<pos.count;i++) uv.setXY(i,(pos.getX(i)+half)/(half*2),(pos.getY(i)+half)/(half*2));
      const mesh=new THREE.Mesh(surface,new THREE.MeshBasicMaterial({transparent:true,alphaTest:.01,side:THREE.DoubleSide,depthWrite:true}));
      mesh.position.z=height/2+.003;mesh.renderOrder=4;specimen.add(mesh);refs.map=mesh;
    }
    const grid=new THREE.GridHelper(11,22,0x28516b,0x122d42);grid.rotation.x=Math.PI/2;grid.position.z=-height/2-.35;
    grid.material.transparent=true;grid.material.opacity=.5;specimen.add(grid);
    const axes=new THREE.AxesHelper(.8);axes.position.set(-3.7,-2.7,-height/2-.3);specimen.add(axes);
    controls.maxDistance=Math.max(35,height*5);camera.far=Math.max(150,height*10);camera.updateProjectionMatrix();
  }
  function slab(mesh,base,height,visible=true) {
    mesh.visible=visible && height>1e-7;
    mesh.position.z=base;mesh.scale.z=Math.max(height,1e-7);
  }
  function update(next) {
    if(disposed || failed) return;
    try {
      const lastMode=state.mode, first=!geometryKey;
      state={...state,...next};
      const key=[state.mode,state.thicknessUm,state.diameterUm,state.gapUm,state.holeCount,state.layout,state.depthUm,state.cutaway].join('|');
      const fresh=key!==geometryKey;
      if(fresh) {rebuild(state);geometryKey=key;}
      const s=state, p=s.process || processState(s.progress), {height:h,unit,radius}=refs;
      const optical=s.mode==='optical', stress=s.mode==='stress', process=s.mode==='process';
      const {drill,fill,remaining,bottom,depth}=twinLayout(s);
      for(const via of refs.vias) {
        slab(via.holeEdge,h/2-h*drill,h*drill,process);
        slab(via.holeWall,h/2-h*drill,h*drill,process);
        slab(via.plug,bottom,remaining,process);
        slab(via.copper,bottom,h*fill,process);
        slab(via.plugTop,h/2-depth,Math.max(0,remaining-(h-depth)),process);
        slab(via.plugBottom,bottom,Math.min(depth,remaining),process);
        via.beam.visible=process && p.phaseId==='drilling';
        via.beam.scale.y=1.3+h*drill;
        via.beam.position.z=h/2+.65-h*drill/2;
      }
      slab(refs.top,h/2-depth,depth,!optical);
      slab(refs.bottom,bottom,depth,!optical);
      slab(refs.core,bottom+depth,h-2*depth,stress);
      if(stress) {
        const model=globalThis.GlassModels;
        const surface=model.balancedStress({...s,zUm:0}).stressMPa;
        const core=model.balancedStress({...s,zUm:s.thicknessUm/2}).stressMPa;
        refs.top.material.opacity=refs.bottom.material.opacity=.55*clamp(Math.abs(surface)/800);
        refs.core.material.opacity=.45*clamp(core/300);
      } else refs.top.material.opacity=refs.bottom.material.opacity=.26;
      refs.plate.material.opacity=optical?.1:stress?.09:.22;
      refs.probe.visible=optical;
      if(optical) {
        const texture=opticalTexture(s);
        if(refs.map.material.map!==texture) {refs.map.material.map=texture;refs.map.material.needsUpdate=true;}
        const theta=s.probeAngleDeg*Math.PI/180, r=radius*s.probeRadiusOverA;
        refs.probe.position.set(r*Math.cos(theta),r*Math.sin(theta),h/2+.045);
        refs.probe.visible=!s.cutaway || refs.probe.position.y>=0;
      }
      if(fresh) setView(first || lastMode!==s.mode ? (optical?'top':'perspective') : cameraView);
      // The first call starts with the camera at the origin.
      if(camera.position.length()===0) resetView();
      applyStoryboardCamera();syncAnimation();render();
    } catch(error) {fail(error);}
  }
  function dispose() {
    if(disposed) return;
    disposed=true;cancelAnimationFrame(frame);observer?.disconnect();
    document.removeEventListener('visibilitychange',visibilityChanged);
    controls?.removeEventListener('change',render);controls?.removeEventListener('start',interactionStarted);controls?.dispose();
    release(scene);textureCache.forEach(t=>t.dispose());textureCache.clear();
    if(renderer) {renderer.domElement.removeEventListener('webglcontextlost',contextLost);renderer.dispose();renderer.domElement.remove();}
  }
  return {update,resetView,setView,dispose};
}
