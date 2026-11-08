/* Analytic teaching models, not reproductions or validated engineering solvers.
 * Units are named explicitly. C is entered numerically in 10^-12 Pa^-1.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GlassModels = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const pi = Math.PI;
  function finite(n, name) { if (typeof n !== 'number' || !Number.isFinite(n)) throw new RangeError(name + ' must be finite'); return n; }
  function positive(n, name) { finite(n, name); if (n <= 0) throw new RangeError(name + ' must be > 0'); return n; }
  function nonnegative(n, name) { finite(n, name); if (n < 0) throw new RangeError(name + ' must be >= 0'); return n; }
  function interval(n, low, high, name) { finite(n, name); if (n < low || n > high) throw new RangeError(name + ' out of range'); return n; }
  function checked(n) { if (!Number.isFinite(n)) throw new RangeError('Result exceeds finite numerical range'); return n; }
  function unit(n) { return Math.max(0, Math.min(1, n)); }
  function samples(n) { interval(n, 2, 10000, 'samples'); if (!Number.isInteger(n)) throw new RangeError('samples must be integer'); return n; }
  // z=0 at the top surface; tensile stress positive. Rectangular layers, no edge effects.
  function balancedStress({thicknessUm, depthUm, compressionMPa, zUm = 0}) {
    positive(thicknessUm, 'thicknessUm'); nonnegative(depthUm, 'depthUm');
    if (depthUm >= thicknessUm / 2) throw new RangeError('depthUm must be < thicknessUm/2');
    nonnegative(compressionMPa, 'compressionMPa'); interval(zUm, 0, thicknessUm, 'zUm');
    const interiorTensionMPa = checked(2 * compressionMPa * depthUm / (thicknessUm - 2 * depthUm));
    const inCompression = depthUm > 0 && (zUm < depthUm || zUm > thicknessUm - depthUm);
    return {stressMPa: inCompression ? -compressionMPa : interiorTensionMPa, interiorTensionMPa,
      meanStressMPa: 0, integratedForceMPaUm: 0, inCompression, zUm};
  }
  function balancedProfile(options) {
    const n = samples(options.samples === undefined ? 201 : options.samples);
    return Array.from({length:n}, (_, i) => balancedStress({...options,zUm:options.thicknessUm*i/(n-1)}));
  }
  // Kirsch: infinite isotropic plate, traction-free circular hole, remote x tension.
  function kirsch({x, y, loadMPa}) {
    finite(x, 'x'); finite(y, 'y'); nonnegative(loadMPa, 'loadMPa');
    const rawRadius = Math.hypot(x,y);
    if (rawRadius < 1 - 1e-12) return {excluded:true, r:rawRadius};
    const r = checked(Math.max(1, rawRadius)); // roundoff tolerance at the traction-free boundary
    const theta = Math.atan2(y,x), c = Math.cos(theta), s = Math.sin(theta), q = 1/(r*r);
    const rr = loadMPa/2*((1-q)+(1-4*q+3*q*q)*Math.cos(2*theta));
    const tt = loadMPa/2*((1+q)-(1+3*q*q)*Math.cos(2*theta));
    const rt = -loadMPa/2*(1+2*q-3*q*q)*Math.sin(2*theta);
    const sigmaX = checked(rr*c*c+tt*s*s-2*rt*s*c);
    const sigmaY = checked(rr*s*s+tt*c*c+2*rt*s*c);
    const tauXY = checked((rr-tt)*s*c+rt*(c*c-s*s));
    const principalDifferenceMPa = checked(Math.hypot(sigmaX-sigmaY,2*tauXY));
    return {excluded:false,r,thetaRad:theta,sigmaX,sigmaY,tauXY,sigmaXMPa:sigmaX,sigmaYMPa:sigmaY,tauXYMPa:tauXY,
      sigmaRR:rr,sigmaTT:tt,tauRT:rt,principalDifferenceMPa,
      principalMaxMPa:checked((sigmaX+sigmaY+principalDifferenceMPa)/2),
      principalMinMPa:checked((sigmaX+sigmaY-principalDifferenceMPa)/2),
      angleRad:principalDifferenceMPa === 0 ? 0 : Math.atan2(2*tauXY,sigmaX-sigmaY)/2};
  }
  function radialProfile({angleRad=pi/2,maxRadius=5,samples:count=101,loadMPa}) {
    finite(angleRad,'angleRad'); interval(maxRadius,1,1e9,'maxRadius'); const n=samples(count);
    return Array.from({length:n},(_,i)=> { const r=1+(maxRadius-1)*i/(n-1);return kirsch({x:r*Math.cos(angleRad),y:r*Math.sin(angleRad),loadMPa}); });
  }
  function retardanceNm({coefficient,stressDifferenceMPa,thicknessUm}) {
    finite(coefficient,'coefficient'); nonnegative(stressDifferenceMPa,'stressDifferenceMPa'); nonnegative(thicknessUm,'thicknessUm');
    return checked(coefficient*stressDifferenceMPa*thicknessUm*1e-3);
  }
  function crossedTransmission({retardanceNm:gamma,wavelengthNm,angleRad}) {
    finite(gamma,'retardanceNm');positive(wavelengthNm,'wavelengthNm');finite(angleRad,'angleRad');
    const delta = checked(pi*gamma/wavelengthNm);
    return unit(Math.sin(2*angleRad)**2*Math.sin(delta)**2);
  }
  // Jones vector [Ex.re,Ex.im,Ey.re,Ey.im]; lossless linear retarders.
  function retarder(v,delta,angle) {
    const c=Math.cos(angle),s=Math.sin(angle),h=delta/2,ch=Math.cos(h),sh=Math.sin(h);
    const ar=c*v[0]+s*v[2],ai=c*v[1]+s*v[3],br=-s*v[0]+c*v[2],bi=-s*v[1]+c*v[3];
    const aR=ar*ch-ai*sh,aI=ar*sh+ai*ch,bR=br*ch+bi*sh,bI=-br*sh+bi*ch;
    return [c*aR-s*bR,c*aI-s*bI,s*aR+c*bR,s*aI+c*bI];
  }
  // Sample first, optional waveplate second, then crossed analyzer. Intensity / input after polarizer.
  function jonesTransmission({retardanceNm:gamma,wavelengthNm,angleRad,waveplateRetardanceNm=0,waveplateAngleRad=0,polarizerAngleRad=0}) {
    finite(gamma,'retardanceNm'); positive(wavelengthNm,'wavelengthNm'); finite(angleRad,'angleRad');
    finite(waveplateRetardanceNm,'waveplateRetardanceNm'); finite(waveplateAngleRad,'waveplateAngleRad'); finite(polarizerAngleRad,'polarizerAngleRad');
    let v=[Math.cos(polarizerAngleRad),0,Math.sin(polarizerAngleRad),0];
    v=retarder(v,checked(2*pi*gamma/wavelengthNm),angleRad);
    v=retarder(v,checked(2*pi*waveplateRetardanceNm/wavelengthNm),waveplateAngleRad);
    const a=-Math.sin(polarizerAngleRad), b=Math.cos(polarizerAngleRad);
    return unit((a*v[0]+b*v[2])**2+(a*v[1]+b*v[3])**2);
  }
  // Mode-I LEFM singular-field estimate outside a user-chosen excluded core.
  function crackTip({stressMPa,crackLengthUm,geometryFactor=1,toughnessMPaSqrtM,rUm,coreRadiusUm=0.1}) {
    nonnegative(stressMPa,'stressMPa');nonnegative(crackLengthUm,'crackLengthUm');positive(geometryFactor,'geometryFactor');
    positive(toughnessMPaSqrtM,'toughnessMPaSqrtM');nonnegative(rUm,'rUm');positive(coreRadiusUm,'coreRadiusUm');
    const ki=checked(geometryFactor*stressMPa*Math.sqrt(pi*crackLengthUm*1e-6)),excluded=rUm<coreRadiusUm;
    return {kiMPaSqrtM:ki,instabilityRatio:checked(ki/toughnessMPaSqrtM),excluded,
      sigmaTipMPa:excluded?null:checked(ki/Math.sqrt(2*pi*rUm*1e-6))};
  }
  // Leading mode-I field for a prescribed crack on negative x; tip at origin.
  // Linear elasticity outside core only. Does not evolve a crack or model a process zone.
  function modeICrackField({xUm,yUm,stressMPa,crackLengthUm,geometryFactor=1,toughnessMPaSqrtM,coreRadiusUm=1}) {
    finite(xUm,'xUm');finite(yUm,'yUm');
    const rUm=checked(Math.hypot(xUm,yUm)),thetaRad=Math.atan2(yUm,xUm);
    const tip=crackTip({stressMPa,crackLengthUm,geometryFactor,toughnessMPaSqrtM,rUm,coreRadiusUm});
    const common={excluded:tip.excluded,rUm,thetaRad,kiMPaSqrtM:tip.kiMPaSqrtM,instabilityRatio:tip.instabilityRatio};
    if(tip.excluded) return {...common,sigmaXX:null,sigmaYY:null,tauXY:null,principalDifferenceMPa:null,angleRad:null};
    const c=Math.cos(thetaRad/2),s=Math.sin(thetaRad/2),s3=Math.sin(3*thetaRad/2),c3=Math.cos(3*thetaRad/2);
    const scale=tip.sigmaTipMPa*c;
    const sigmaXX=checked(scale*(1-s*s3)),sigmaYY=checked(scale*(1+s*s3)),tauXY=checked(scale*s*c3);
    const principalDifferenceMPa=checked(Math.hypot(sigmaXX-sigmaYY,2*tauXY));
    return {...common,sigmaXX,sigmaYY,tauXY,principalDifferenceMPa,
      angleRad:principalDifferenceMPa===0?0:Math.atan2(2*tauXY,sigmaXX-sigmaYY)/2};
  }
  // Synthetic axial reflectivity envelopes, NOT an OCT forward/reconstruction solver.
  // phaseRad is birefringent round-trip phase; stress is an effective signed difference.
  function octProfile({depthUm=500,samples:count=201,scatterers=[{depthUm:100,widthUm:10,amplitude:1}],coefficient=3,stressMPa=0,wavelengthNm=1300}) {
    positive(depthUm,'depthUm');const n=samples(count); finite(coefficient,'coefficient');finite(stressMPa,'stressMPa');positive(wavelengthNm,'wavelengthNm');
    if (!Array.isArray(scatterers) || scatterers.length>1000) throw new RangeError('Invalid scatterers');
    scatterers.forEach(p=> {interval(p.depthUm,0,depthUm,'scatterer depthUm');positive(p.widthUm,'widthUm');nonnegative(p.amplitude,'amplitude');});
    return Array.from({length:n},(_,i)=> {const zUm=depthUm*i/(n-1);
      const amplitude=checked(scatterers.reduce((sum,p)=>sum+p.amplitude*Math.exp(-0.5*((zUm-p.depthUm)/p.widthUm)**2),0));
      const phaseRad=checked(4*pi*coefficient*stressMPa*zUm*1e-3/wavelengthNm);
      return {zUm,amplitude,intensity:checked(amplitude*amplitude),phaseRad,real:amplitude*Math.cos(phaseRad),imag:amplitude*Math.sin(phaseRad)};
    });
  }
  // Ideal two-beam reflection signal. Periodicity means length inversion is nonunique.
  function twoBeamIntensity({visibility=1,refractiveIndex=1,lengthNm,wavelengthNm,phaseRad=0}) {
    interval(visibility,0,1,'visibility');positive(refractiveIndex,'refractiveIndex');nonnegative(lengthNm,'lengthNm');positive(wavelengthNm,'wavelengthNm');finite(phaseRad,'phaseRad');
    return unit(0.5*(1+visibility*Math.cos(checked(4*pi*refractiveIndex*lengthNm/wavelengthNm+phaseRad))));
  }
  // Time and tau must use the same unit. No temperature-dependent kinetics asserted.
  function annealStress({initialStressMPa,time,tau}) {
    finite(initialStressMPa,'initialStressMPa');nonnegative(time,'time');positive(tau,'tau');return initialStressMPa*Math.exp(-time/tau);
  }
  return {balancedStress,balancedProfile,kirsch,radialProfile,retardanceNm,crossedTransmission,jonesTransmission,crackTip,modeICrackField,octProfile,twoBeamIntensity,annealStress};
});
