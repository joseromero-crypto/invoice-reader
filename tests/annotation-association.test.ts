import {describe,it,expect} from 'vitest';
import {ExtractionSchema,exportCsv,type Product,type Document} from '../shared/domain';
import {buildInvoiceRows} from '../server/match-extraction';
import {annotationAssociations} from '../shared/annotation-association';
const products:Product[]=Array.from({length:5},(_,i)=>({id:String(i+1),sku:`CAT${i+1}`,name:`Synthetic product ${i+1}`,supplier:'TEST',supplierSku:`K${i+1}`,barcode:null,unit:'pz'}));
function invoice(){return ExtractionSchema.parse({supplier:'TEST',reference:'TEST',date:null,currency:null,printedPage:null,printedPageCount:null,printedTotal:null,warnings:[],rows:products.map((p,i)=>({sourceRow:i+1,sourcePage:i===4?2:1,supplierSku:p.supplierSku,barcode:null,description:p.name,quantity:20+i,unit:'PZ',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:`${p.supplierSku} ${p.name} ${20+i} PZ`,reception:{kind:'check',text:null,quantity:null},receptionMarked:true,flags:[]})),annotationEvidence:{rows:products.map((_,i)=>({sourceRow:i+1,sourcePage:i===4?2:1,inspection:'complete',baseline:{start:{x:0.1,y:0.1+i*0.1},end:{x:0.9,y:0.3+i*0.1}}})),marks:products.map((_,i)=>({id:`check${i+1}`,sourcePage:i===4?2:1,kind:'check',text:null,quantity:null,position:{x:0.5,y:0.2+i*0.1},candidateRows:[i+1],anchorSupplierSku:`K${i+1}`,association:'certain'}))}});}
const numeric=()=>({id:'number',sourcePage:1,kind:'changed_quantity' as const,text:'7',quantity:7,position:{x:0.2,y:0.225},candidateRows:[2],anchorSupplierSku:'K2',association:'certain' as const});
function output(rows:ReturnType<typeof buildInvoiceRows>){const doc:Document={id:'d',supplier:'TEST',reference:'TEST',image:null,pages:2,expectedPages:null,warnings:[],printedTotal:null,rows};return exportCsv([doc],true);}
describe('independent annotation association',()=>{
 it('traces a slanted baseline and blocks a correction beside a check without replacing print',()=>{
  const raw=invoice();raw.annotationEvidence!.marks.push(numeric());raw.rows[1].rawText+='; manuscrito: 7';const before=JSON.stringify(raw),rows=buildInvoiceRows(raw,products);
  expect(rows[1].billedQuantity).toBe(21);expect(rows[1].proposedQuantity).toBe(21);expect(rows[1].confirmedQuantity).toBeNull();expect(rows[1].receptionMarked).toBe(false);expect(rows[1].flags.join()).toContain('changed_quantity');
  expect(rows.filter(r=>r.confirmed).map(r=>r.sourceRow)).toEqual([1,3,4,5]);expect(output(rows).excluded).toEqual(['TEST / 2']);expect(output(rows).csv).not.toContain('CAT2');expect(JSON.stringify(raw)).toBe(before);
 });
 it('still reviews neighboring rows when a second transcribed number is missing from inventory',()=>{
  const raw=invoice();raw.annotationEvidence!.marks.push(numeric());raw.rows[1].rawText+='; manuscrito: 7 y 6';const rows=buildInvoiceRows(raw,products);expect(rows.slice(0,3).every(r=>!r.confirmed)).toBe(true);expect(rows[3].confirmed).toBe(true);
 });
 it('uses the same association on sideways photos',()=>{
  const raw=invoice();raw.annotationEvidence!.marks.push(numeric());const rotate=(p:{x:number;y:number})=>({x:1-p.y,y:p.x});for(const row of raw.annotationEvidence!.rows){row.baseline={start:rotate(row.baseline!.start),end:rotate(row.baseline!.end)};}for(const mark of raw.annotationEvidence!.marks)mark.position=rotate(mark.position!);const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows.filter(r=>r.confirmed).map(r=>r.sourceRow)).toEqual([1,3,4,5]);
 });
 it('keeps both competing rows pending when declared row/key disagree with baseline geometry',()=>{
  const raw=invoice();raw.annotationEvidence!.marks.push({...numeric(),candidateRows:[3],anchorSupplierSku:'K3'});
  const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[2].confirmed).toBe(false);expect(rows[1].flags.join()).toContain('asociación');expect(rows[2].flags.join()).toContain('asociación');expect(rows.filter(r=>r.confirmed).map(r=>r.sourceRow)).toEqual([1,4,5]);
 });
 it('blocks all plausible rows for a boundary mark, not the nearest horizontal row',()=>{
  const raw=invoice();raw.annotationEvidence!.marks.push({...numeric(),position:{x:0.2,y:0.275},candidateRows:[2,3],anchorSupplierSku:null,association:'ambiguous'});
  const rows=buildInvoiceRows(raw,products);expect(output(rows).excluded).toEqual(['TEST / 2','TEST / 3']);expect(rows[0].confirmed).toBe(true);
 });
 it('retains unreadable arithmetic and null handwriting quantity as unresolved',()=>{
  const raw=invoice();raw.annotationEvidence!.marks.push({...numeric(),kind:'ambiguous',text:'? + 4',quantity:null});const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[1].billedQuantity).toBe(21);expect(raw.annotationEvidence!.marks.at(-1)!.quantity).toBeNull();
 });
 it('does not accept a numeric check or an arithmetic same-quantity claim',()=>{
  for(const observation of [{kind:'check',text:'✓ 7',quantity:null},{kind:'same_quantity',text:'10+11',quantity:21}]){
   const raw=invoice();raw.rows[1].reception=observation as any;const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[1].flags.join()).toContain('Recepción pendiente');
  }
 });
 it('does not promote a signature, absent mark or explicitly unclear check',()=>{
  for(const observation of [{kind:'signature',text:null,quantity:null},{kind:'none',text:null,quantity:null},{kind:'check',text:'unclear',quantity:null},{kind:'check',text:'?',quantity:null}]){const raw=invoice();raw.rows[1].reception=observation as any;const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[0].confirmed).toBe(true);}
 });
 it('requires manual pieces even for repeated printed handwriting beside a check',()=>{
  const raw=invoice();raw.annotationEvidence!.marks.push({...numeric(),kind:'same_quantity',text:'21',quantity:21});raw.rows[1].reception={kind:'same_quantity',text:'21',quantity:21};const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[1].confirmedQuantity).toBeNull();expect(rows[1].billedQuantity).toBe(21);expect(rows[0].confirmed).toBe(true);
 });
 it('contains incomplete inspection and omitted mark inventory locally',()=>{
  const raw=invoice();raw.annotationEvidence!.rows[1].inspection='uncertain';raw.annotationEvidence!.marks=raw.annotationEvidence!.marks.filter(m=>m.id!=='check3');const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[2].confirmed).toBe(false);expect(rows.filter(r=>r.confirmed).map(r=>r.sourceRow)).toEqual([1,4,5]);
 });
 it('contains legacy numeric notes on immediate same-photo neighbors without rematching',()=>{
  const raw=invoice();delete raw.annotationEvidence;raw.rows[2].reception={kind:'ambiguous',text:'7',quantity:null};raw.rows[2].flags=['conflicto_cantidad_manuscrita: 7 vs 22'];const rows=buildInvoiceRows(raw,products);expect(rows.filter(r=>!r.confirmed).map(r=>r.sourceRow)).toEqual([2,3,4]);expect(rows[1].flags.join()).toContain('sin localización independiente');expect(rows[4].confirmed).toBe(true);expect(rows[1].billedQuantity).toBe(21);expect(rows[2].flags).not.toContain('conflicto_cantidad_manuscrita: 7 vs 22');expect(rows[2].flags.join()).toContain('asociación por verificar');expect(raw.rows[2].flags).toEqual(['conflicto_cantidad_manuscrita: 7 vs 22']);
 });
 it('keeps distant checks usable when one baseline is unreadable',()=>{
  const raw=invoice();raw.annotationEvidence!.rows[3].baseline=null;const rows=buildInvoiceRows(raw,products);expect(rows[0].confirmed).toBe(true);expect(rows[1].confirmed).toBe(true);expect(rows[3].confirmed).toBe(false);expect(rows[4].confirmed).toBe(true);
 });
 it('rejects invalid references and duplicate mark ids rather than dropping evidence',()=>{
  const raw=invoice();raw.annotationEvidence!.marks.push({...numeric(),candidateRows:[5]});expect(()=>annotationAssociations(raw)).toThrow('reference');raw.annotationEvidence!.marks.pop();raw.annotationEvidence!.marks.push({...numeric(),id:'check1'});expect(()=>annotationAssociations(raw)).toThrow('Duplicate');
 });
 it('preserves crosses, circles and unfamiliar loops as pending while checks remain usable',()=>{
  for(const kind of ['cross','circle','ambiguous'] as const){const raw=invoice();raw.annotationEvidence!.marks.push({...numeric(),kind,text:kind,quantity:null});const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[0].confirmed).toBe(true);}
 });
 it('does not trust a claimed certain mark when position/baselines are missing',()=>{
  const raw=invoice();raw.annotationEvidence!.marks[1].position=null;const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[1].flags.join()).toContain('asociación');expect(rows[0].confirmed).toBe(true);
 });
});
