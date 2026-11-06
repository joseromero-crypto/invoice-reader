import {it,expect} from 'vitest';
import {isPdf,pageScale} from '../src/lib/pdfPages';
const bytes=(s:string)=>new TextEncoder().encode(s);
it('recognizes a PDF by its bytes, not its name or type',()=>{
 expect(isPdf(bytes('%PDF-1.7'))).toBe(true);
 expect(isPdf(new Uint8Array([255,216,255,224,0]))).toBe(false);
 expect(isPdf(new Uint8Array())).toBe(false);
});
it('renders the long edge at the size the worker keeps, whatever the page size',()=>{
 expect(612*pageScale(612,792)).toBeCloseTo(1991,0);expect(792*pageScale(612,792)).toBeCloseTo(2576);
 expect(4000*pageScale(4000,1000)).toBeCloseTo(2576);
});
