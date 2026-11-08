import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {plateShape, diskShape, extrusion, twinLayout} from './twin-scene.js';

const physical={thicknessUm:500,diameterUm:100,depthUm:30};
const close=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
function signedVolume(g) {
  const p=g.attributes.position;let sum=0;
  for(let i=0;i<p.count;i+=3) {
    const a=new THREE.Vector3().fromBufferAttribute(p,i);
    const b=new THREE.Vector3().fromBufferAttribute(p,i+1);
    const c=new THREE.Vector3().fromBufferAttribute(p,i+2);
    sum+=a.dot(b.cross(c))/6;
  }
  return sum;
}
function geometry(shape, fn) {const g=extrusion(shape);try {fn(g);}finally{g.dispose();}}

for(const half of [false,true]) {
  test(`${half?'Half':'Full'} plate has the expected cylindrical void and positive signed volume`,()=>{
    for(const hole of [false,true]) geometry(plateShape(3,.5,half,hole),g=>{
      const expected=(36-(hole?Math.PI*.25:0))*(half?.5:1);
      close(signedVolume(g),expected,.0003);
      g.computeBoundingBox();
      close(g.boundingBox.min.x,-3);close(g.boundingBox.max.x,3);
      close(g.boundingBox.min.y,half?0:-3);close(g.boundingBox.max.y,3);
      close(g.boundingBox.min.z,0);close(g.boundingBox.max.z,1);
    });
  });
  test(`${half?'Half':'Full'} copper is closed solid volume, not a ring`,()=>{
    geometry(diskShape(.5,half),g=>{
      close(signedVolume(g),Math.PI*.25*(half?.5:1),.0003);
      const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(g,material);mesh.updateMatrixWorld();
      const ray=new THREE.Raycaster(new THREE.Vector3(0,half?.1:0,2),new THREE.Vector3(0,0,-1));
      const hits=ray.intersectObject(mesh);
      assert.ok(hits.some(hit=>Math.abs(hit.point.z-1)<1e-6),'solid cap covers the center');
      material.dispose();
    });
  });
  test(`${half?'Half':'Full'} plug precisely complements the plate void`,()=>{
    geometry(plateShape(3,.5,half),plate=>geometry(diskShape(.5,half),plug=>{
      close(signedVolume(plate)+signedVolume(plug),36*(half?.5:1),1e-6);
    }));
  });
}

test('Half copper cut face lies at y=0, closes the cylinder, and aligns with plate cut plane',()=>{
  geometry(diskShape(.5,true),g=>{
    const p=g.attributes.position;let area=0;
    for(let i=0;i<p.count;i+=3) {
      const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,i+j));
      if(vertices.every(v=>Math.abs(v.y)<1e-6)) {
        const [a,b,c]=vertices;area+=b.clone().sub(a).cross(c.clone().sub(a)).length()/2;
      }
      assert.ok(vertices.every(v=>v.y>=-1e-6),'no geometry leaks into removed half');
    }
    close(area,1); // diameter (1) × extrusion depth (1)
  });
});

test('Top plane retains a real empty hole and positive-y semicircular notch',()=>{
  for(const half of [false,true]) geometry(plateShape(3,.5,half),g=>{
    const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(g,material);mesh.updateMatrixWorld();
    const shoot=(x,y)=>new THREE.Raycaster(new THREE.Vector3(x,y,2),new THREE.Vector3(0,0,-1)).intersectObject(mesh);
    assert.equal(shoot(0,.1).length,0);
    assert.ok(shoot(1,.1).length>0);
    if(half) assert.equal(shoot(1,-.1).length,0);
    material.dispose();
  });
});

test('Process endpoint transforms preserve aspect ratio and exact bottom-up full fill',()=>{
  const initial=twinLayout({...physical,progress:0});
  close(initial.radius/initial.height,physical.diameterUm/(2*physical.thicknessUm));
  close(initial.remaining,initial.height);close(initial.copperHeight,0);close(initial.depth,0);
  const blind=twinLayout({...physical,progress:.4});
  close(blind.drill,.5);close(blind.remaining,blind.height/2);
  close(blind.bottom+blind.remaining,0);close(blind.fill,0);
  const through=twinLayout({...physical,progress:.62});
  close(through.remaining,0);close(through.copperHeight,0);
  const fill=twinLayout({...physical,progress:.86});
  close(fill.copperHeight,fill.height/2);close(fill.bottom+fill.copperHeight,0);
  const end=twinLayout({...physical,progress:1});
  close(end.remaining,0);close(end.copperHeight,end.height);
  close(end.bottom+end.copperHeight,end.height/2);
  close(end.depth/end.height,physical.depthUm/physical.thicknessUm);
  for(const half of [false,true]) geometry(diskShape(end.radius,half),g=>{
    const actual=signedVolume(g)*end.copperHeight/end.unit**3;
    const expected=Math.PI*(physical.diameterUm/2)**2*physical.thicknessUm*(half?.5:1);
    assert.ok(Math.abs(actual/expected-1)<.0003);
  });
});

test('Optical reference stays at ±4a with empty hole, independent of process fill',()=>{
  for(const diameterUm of [20,100,500]) {
    const s=twinLayout({...physical,diameterUm,mode:'optical',progress:1});
    close(3/s.radius,4);close(s.drill,1);close(s.fill,0);close(s.remaining,0);
    close(s.height/s.unit,physical.thicknessUm);
  }
});

test('Stress mode has no copper and uses prescribed physical layer depths',()=>{
  const s=twinLayout({...physical,mode:'stress',progress:1});
  close(s.fill,0);close(s.drill,0);close(s.depth/s.unit,physical.depthUm);
  close((s.height-2*s.depth)/s.unit,physical.thicknessUm-2*physical.depthUm);
});

test('Internal cylindrical glass interfaces are removed, exposed drilled walls retain their full arc',async()=>{
  const {cylinderSurfaceSubset}=await import('./twin-scene.js');
  for(const half of [false,true]) geometry(diskShape(.5,half),g=>{
    const shell=cylinderSurfaceSubset(g,.5,false), wall=cylinderSurfaceSubset(g,.5,true);
    try {
      assert.equal(shell.index.count+wall.index.count,g.attributes.position.count);
      const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
      const shellMesh=new THREE.Mesh(shell,material),wallMesh=new THREE.Mesh(wall,material);
      shellMesh.updateMatrixWorld();wallMesh.updateMatrixWorld();
      const ray=new THREE.Raycaster(new THREE.Vector3(0,2,.5),new THREE.Vector3(0,-1,0));
      // Cutaway has its real flat cut face at y=0, but no hidden curved interface.
      assert.ok(ray.intersectObject(shellMesh).every(hit=>Math.abs(hit.point.y)<1e-6));
      assert.ok(ray.intersectObject(wallMesh).some(hit=>Math.abs(hit.point.y-.5)<1e-6));
      wallMesh.position.z=.25;wallMesh.scale.z=.5;wallMesh.updateMatrixWorld();
      const lowerRay=new THREE.Raycaster(new THREE.Vector3(0,2,.1),new THREE.Vector3(0,-1,0));
      assert.equal(lowerRay.intersectObject(wallMesh).length,0,'no outlined or glass wall below drilling depth');
      material.dispose();
    } finally {shell.dispose();wall.dispose();}
  });
});

test('Storyboard camera exact keys, bounded continuous motion, and finite endpoints',async()=>{
  const {storyboardCameraPose,STORYBOARD_CAMERA_KEYS}=await import('./twin-scene.js');
  for(const key of STORYBOARD_CAMERA_KEYS) {
    assert.deepEqual(storyboardCameraPose(key.progress),key);
    if(key.progress>0 && key.progress<1) {
      const left=storyboardCameraPose(key.progress-1e-7),right=storyboardCameraPose(key.progress+1e-7);
      for(const field of ['azimuthDeg','elevationDeg','targetZOverHeight','zoom']) close(left[field],right[field],1e-5);
    }
  }
  assert.deepEqual(storyboardCameraPose(-2),storyboardCameraPose(0));
  assert.deepEqual(storyboardCameraPose(3),storyboardCameraPose(1));
  assert.throws(()=>storyboardCameraPose(NaN),RangeError);
  for(let i=0;i<=1000;i++) {
    const pose=storyboardCameraPose(i/1000);
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(pose.azimuthDeg>=-90 && pose.azimuthDeg<=-60);
    assert.ok(pose.elevationDeg>=8 && pose.elevationDeg<=60);
    assert.ok(pose.zoom>=.8 && pose.zoom<=1);
    assert.ok(pose.targetZOverHeight>=-.25 && pose.targetZOverHeight<=.2);
  }
});
