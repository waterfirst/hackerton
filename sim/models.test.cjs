'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),m=require('./models.js');
const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
test('balanced layer force, sign, depth and zero depth',()=> {
 const p={thicknessUm:500,depthUm:50,compressionMPa:400};
 near(m.balancedStress({...p,zUm:250}).stressMPa,100);
 near(-2*400*50+m.balancedStress(p).interiorTensionMPa*400,0);
 near(m.balancedStress(p).stressMPa,-400);
 near(m.balancedStress({...p,depthUm:0}).stressMPa,0);
 assert.throws(()=>m.balancedStress({...p,depthUm:250}),RangeError);
});
test('Kirsch traction free boundary, 3x hoop stress, far field and excluded hole',()=> {
 const p=m.kirsch({x:0,y:1,loadMPa:20});near(p.sigmaRR,0);near(p.tauRT,0);near(p.sigmaTT,60);near(p.principalDifferenceMPa,60);
 const f=m.kirsch({x:1e6,y:1e6,loadMPa:20});near(f.sigmaX,20,1e-8);near(f.sigmaY,0,1e-8);near(f.tauXY,0,1e-8);
 assert.equal(m.kirsch({x:0,y:0,loadMPa:20}).excluded,true);
 near(m.kirsch({x:1,y:0,loadMPa:0}).principalDifferenceMPa,0);
});
test('stress-optic units and crossed polarizer extrema',()=> {
 near(m.retardanceNm({coefficient:3,stressDifferenceMPa:100,thicknessUm:500}),150);
 near(m.crossedTransmission({retardanceNm:275,wavelengthNm:550,angleRad:Math.PI/4}),1);
 near(m.crossedTransmission({retardanceNm:275,wavelengthNm:550,angleRad:0}),0);
 near(m.crossedTransmission({retardanceNm:0,wavelengthNm:550,angleRad:1}),0);
});
test('Jones agrees with crossed formula without waveplate and preserves bounded intensity',()=> {
 for(let i=0;i<100;i++) {const p={retardanceNm:i*31,wavelengthNm:550,angleRad:i/9};near(m.jonesTransmission(p),m.crossedTransmission(p));
 const v=m.jonesTransmission({...p,waveplateRetardanceNm:137.5,waveplateAngleRad:i/7});assert.ok(v>=0&&v<=1);}
});
test('LEFM SI units, ratio is deterministic and core is excluded',()=> {
 const p={stressMPa:100,crackLengthUm:1000,geometryFactor:1,toughnessMPaSqrtM:1,rUm:10};
 near(m.crackTip(p).kiMPaSqrtM,100*Math.sqrt(Math.PI*0.001));
 near(m.crackTip(p).sigmaTipMPa,100*Math.sqrt(0.001/(2*10e-6)));
 assert.equal(m.crackTip({...p,rUm:0}).sigmaTipMPa,null);
 near(m.crackTip({...p,stressMPa:0}).instabilityRatio,0);
});
test('OCT Gaussian position and birefringence round-trip units',()=> {
 const p=m.octProfile({depthUm:100,samples:3,scatterers:[{depthUm:50,widthUm:1,amplitude:2}],coefficient:3,stressMPa:100,wavelengthNm:1000});
 near(p[1].amplitude,2);near(p[1].intensity,4);near(p[2].phaseRad,4*Math.PI*0.03);
 near(m.octProfile({stressMPa:0})[50].phaseRad,0);
});
test('interferometry period, no-visibility flatness, anneal endpoints',()=> {
 near(m.twoBeamIntensity({lengthNm:0,wavelengthNm:500}),1);
 near(m.twoBeamIntensity({lengthNm:125,wavelengthNm:500}),0);
 near(m.twoBeamIntensity({lengthNm:250,wavelengthNm:500}),1);
 near(m.twoBeamIntensity({lengthNm:111,wavelengthNm:500,visibility:0}),0.5);
 near(m.annealStress({initialStressMPa:10,time:0,tau:2}),10);
 near(m.annealStress({initialStressMPa:10,time:2,tau:2}),10/Math.E);
});
test('reject invalid and nonfinite inputs instead of silently propagating',()=> {
 assert.throws(()=>m.kirsch({x:NaN,y:1,loadMPa:2}),RangeError);
 assert.throws(()=>m.retardanceNm({coefficient:3,stressDifferenceMPa:-1,thicknessUm:500}),RangeError);
 assert.throws(()=>m.crossedTransmission({retardanceNm:1,wavelengthNm:0,angleRad:0}),RangeError);
 assert.throws(()=>m.twoBeamIntensity({visibility:2,lengthNm:1,wavelengthNm:500}),RangeError);
 assert.throws(()=>m.annealStress({initialStressMPa:10,time:1,tau:0}),RangeError);
 assert.throws(()=>m.octProfile({samples:2.5}),RangeError);
});

test('mode-I angular field: forward biaxial stress, free crack faces, zero load and excluded core',()=> {
 const p={xUm:10,yUm:0,stressMPa:100,crackLengthUm:1000,toughnessMPaSqrtM:1};
 const ahead=m.modeICrackField(p);near(ahead.sigmaXX,ahead.sigmaYY);near(ahead.tauXY,0);near(ahead.principalDifferenceMPa,0);
 near(ahead.sigmaXX,m.crackTip({...p,rUm:10}).sigmaTipMPa);
 for(const yUm of [0,-0]) {const face=m.modeICrackField({...p,xUm:-10,yUm});near(face.sigmaYY,0);near(face.tauXY,0);}
 const zero=m.modeICrackField({...p,yUm:10,stressMPa:0});near(zero.sigmaXX,0);near(zero.sigmaYY,0);near(zero.principalDifferenceMPa,0);
 const core=m.modeICrackField({...p,xUm:0});assert.equal(core.excluded,true);assert.equal(core.sigmaXX,null);
 const upper=m.modeICrackField({...p,yUm:10}),lower=m.modeICrackField({...p,yUm:-10});
 near(upper.sigmaXX,lower.sigmaXX);near(upper.sigmaYY,lower.sigmaYY);near(upper.tauXY,-lower.tauXY);
 assert.throws(()=>m.modeICrackField({...p,xUm:Infinity}),RangeError);
});
