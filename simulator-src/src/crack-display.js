/** Display exposure only: no changes to physical I/I0, phase, or crack timing. */
export function intensityDisplay(value,whitePoint=1) {
 if(!Number.isFinite(value)||!Number.isFinite(whitePoint)||whitePoint<=0||whitePoint>1)throw new RangeError('finite intensity and white point in (0,1] required');
 return Math.max(0,Math.min(1,value/whitePoint));
}
