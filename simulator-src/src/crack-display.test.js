import test from 'node:test';
import assert from 'node:assert/strict';
import {intensityDisplay} from './crack-display.js';
test('exposure preserves extinction and fixed linear white point',()=>{for(const cap of [.02,.15,1]){assert.equal(intensityDisplay(0,cap),0);assert.equal(intensityDisplay(cap,cap),1);assert.equal(intensityDisplay(cap/2,cap),.5);assert.equal(intensityDisplay(1,cap),1);}});
test('lower white point brightens only nonzero input monotonically',()=>{const raw=.03;assert.equal(intensityDisplay(raw,.15),.2);assert.equal(intensityDisplay(raw,1),raw);assert.equal(raw,.03);let prev=-1;for(let i=0;i<=100;i++){const n=intensityDisplay(i/100,.15);assert.ok(n>=prev&&n<=1);prev=n;}});
test('invalid display scales rejected',()=>{for(const cap of [0,-1,2,NaN,Infinity])assert.throws(()=>intensityDisplay(.1,cap),RangeError);assert.throws(()=>intensityDisplay(NaN,1),RangeError);});
