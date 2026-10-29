import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Review from '../src/Review';
import {ExtractionSchema,confirmRow,exportCsv,type Document,type Product,type Row} from '../shared/domain';
import {quantityAlignments} from '../shared/quantity-alignment';
import {buildInvoiceRows} from '../server/match-extraction';
import {initialReceivedQuantity,quantityReviewMessage} from '../shared/quantity-review';
const products:Product[]=Array.from({length:5},(_,i)=>({id:`P${i}`,sku:`C${i}`,supplier:'Synthetic',supplierSku:`000${i}`,barcode:null,name:`Artículo prueba ${i}`,unit:'pz'}));
function fixture(slope=0.25){
 const raw=ExtractionSchema.parse({supplier:'Synthetic',reference:'TEST',date:null,currency:null,printedPage:null,printedPageCount:null,printedTotal:null,warnings:[],rows:products.map((p,i)=>({sourceRow:i+1,sourcePage:1,supplierSku:p.supplierSku,barcode:null,description:p.name,quantity:[2,5,7,9,11][i],unit:'PZ',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:`${p.supplierSku} ${p.name}`,flags:[],receptionMarked:true,reception:{kind:'check',text:null,quantity:null}}))});
 raw.quantityEvidence={rows:raw.rows.map((r,i)=>({sourceRow:r.sourceRow,sourcePage:1,baseline:{start:{x:0.1,y:0.1+i*0.12},end:{x:0.5,y:0.1+i*0.12+0.4*slope}}})),cells:raw.rows.map((r,i)=>({id:`cell${i}`,sourcePage:1,text:String(r.quantity),value:r.quantity,position:{x:0.85,y:0.1+i*0.12+0.75*slope},candidateRows:[r.sourceRow],anchorSupplierSku:r.supplierSku,association:'certain'}))};
 return raw;
}
const doc=(rows:Row[]):Document=>({id:'d',supplier:'Synthetic',reference:'TEST',pages:1,expectedPages:null,image:null,warnings:[],printedTotal:null,rows});
it('validates sloped baselines where horizontal proximity points to neighboring items',()=>{
 const raw=fixture(),before=JSON.stringify(raw),rows=buildInvoiceRows(raw,products);
 expect(rows.every(r=>r.confirmed)).toBe(true);expect(rows.map(r=>r.confirmedQuantity)).toEqual([2,5,7,9,11]);expect(JSON.stringify(raw)).toBe(before);
});
it('contains a neighboring-row claim and keeps distant reliable rows automatically confirmed',()=>{
 const raw=fixture();raw.quantityEvidence!.cells[1].candidateRows=[3];
 const rows=buildInvoiceRows(raw,products);
 expect(rows.map(r=>r.confirmed)).toEqual([true,false,false,true,true]);
 expect(rows[1].product).toEqual(products[1]);expect(rows[1].billedQuantity).toBe(5);expect(rows[1].proposedQuantity).toBeNull();expect(initialReceivedQuantity(rows[1])).toBe('');
 expect(exportCsv([doc(rows)],true).excluded).toEqual(['TEST / 2','TEST / 3']);
});
it('does not repair shifted billed numbers from independently read cells or catalog data',()=>{
 const raw=fixture();raw.rows[1].quantity=2;raw.rows[2].quantity=5;const rows=buildInvoiceRows(raw,products);
 expect(rows.map(r=>r.billedQuantity)).toEqual([2,2,5,9,11]);expect(rows.map(r=>r.proposedQuantity)).toEqual([2,null,null,9,11]);expect(rows[0].confirmed).toBe(true);expect(rows[3].confirmed).toBe(true);
});
it('handles multiline descriptions and repeated identifiers as separate printed occurrences',()=>{
 const raw=fixture();raw.rows[2].supplierSku=raw.rows[1].supplierSku;raw.rows[2].description='Artículo prueba 1\ncontinuación impresa';raw.quantityEvidence!.cells[2].anchorSupplierSku=raw.rows[1].supplierSku;
 const rows=buildInvoiceRows(raw,products);expect(rows.every(r=>r.quantityAlignment!.flags.length===0)).toBe(true);expect(rows[1].billedQuantity).toBe(5);expect(rows[2].billedQuantity).toBe(7);expect(rows[2].description).toContain('\n');expect(rows.map(r=>r.sourceRow)).toEqual([1,2,3,4,5]);
});
it('is invariant under a sideways photo coordinate rotation',()=>{
 const raw=fixture();const rotate=(p:{x:number;y:number})=>({x:1-p.y,y:p.x});
 raw.quantityEvidence!.rows.forEach(r=>{r.baseline={start:rotate(r.baseline!.start),end:rotate(r.baseline!.end)};});raw.quantityEvidence!.cells.forEach(c=>{c.position=rotate(c.position!);});
 expect(buildInvoiceRows(raw,products).every(r=>r.confirmed)).toBe(true);
});
it('contains a midpoint cell on both plausible rows without choosing the nearest',()=>{
 const raw=fixture(0);raw.quantityEvidence!.cells[1].position!.y+=0.06;
 const rows=buildInvoiceRows(raw,products);expect(rows.map(r=>r.confirmed)).toEqual([true,false,false,true,true]);
});
it('rejects reused cells, invalid references and duplicate baselines',()=>{
 const raw=fixture();raw.quantityEvidence!.cells.push({...raw.quantityEvidence!.cells[0]});expect(()=>quantityAlignments(raw)).toThrow('Duplicate');
 const bad=fixture();bad.quantityEvidence!.cells[0].sourcePage=2;expect(()=>quantityAlignments(bad)).toThrow('reference');
 const duplicate=fixture();duplicate.quantityEvidence!.rows.push(duplicate.quantityEvidence!.rows[0]);expect(()=>quantityAlignments(duplicate)).toThrow('reference');
});
it('keeps missing and competing cell evidence local, including first and last rows',()=>{
 for(const index of [0,4]){const raw=fixture();raw.quantityEvidence!.cells.splice(index,1);const rows=buildInvoiceRows(raw,products);expect(rows.filter(r=>!r.confirmed).map(r=>r.sourceRow)).toEqual([index+1]);}
 const raw=fixture();raw.quantityEvidence!.cells.push({...raw.quantityEvidence!.cells[1],id:'duplicate-location'});expect(buildInvoiceRows(raw,products).filter(r=>!r.confirmed).map(r=>r.sourceRow)).toEqual([2]);
});
it('does not certify unknown text/value, anchor disagreement or ambiguous attribution',()=>{
 for(const patch of [{text:'?'},{text:'8'},{value:null},{position:null},{anchorSupplierSku:'different'},{association:'ambiguous' as const}]){
  const raw=fixture();Object.assign(raw.quantityEvidence!.cells[1],patch);const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(initialReceivedQuantity(rows[1])).toBe('');expect(rows[4].confirmed).toBe(true);
 }
});
it('missing nearby baselines prevent false uniqueness while other rows stay usable',()=>{
 const raw=fixture();raw.quantityEvidence!.rows[1].baseline=null;
 const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[4].confirmed).toBe(true);
});
it('keeps handwritten safeguards alongside reliable billed geometry',()=>{
 const raw=fixture();raw.rows[2].reception={kind:'circle',text:null,quantity:null};const rows=buildInvoiceRows(raw,products);expect(rows[2].proposedQuantity).toBe(7);expect(rows[2].confirmed).toBe(false);expect(initialReceivedQuantity(rows[2])).toBe('');expect(rows[4].confirmed).toBe(true);
});
it('keeps legacy results compatible and field-local quantity uncertainty requires empty manual entry',()=>{
 const raw=fixture();delete raw.quantityEvidence;expect(buildInvoiceRows(raw,products).every(r=>r.confirmed)).toBe(true);
 raw.rows[1].fieldUncertainties=[{field:'quantity',reason:'Neighbor alignment uncertain'}];const rows=buildInvoiceRows(raw,products);expect(initialReceivedQuantity(rows[1])).toBe('');expect(rows[1].confirmed).toBe(false);expect(rows[4].confirmed).toBe(true);
});
it('shows alignment-specific review, keeps the provisional product replaceable and audits an explicit physical zero',()=>{
 const raw=fixture();raw.rows[1].quantity=2;const row=buildInvoiceRows(raw,products)[1];expect(quantityReviewMessage(row)).toContain('cantidad facturada');expect(quantityReviewMessage(row)).not.toContain('anotaciones manuales');
 const html=renderToStaticMarkup(createElement(Review,{row,products,onClose:()=>{},onConfirm:async()=>{},imageSrc:'',mode:'synthetic'}));expect(html).toContain('asociación por verificar');expect(html).toMatch(/id="actual-pieces"[^>]*value=""/);expect(html).toContain('Buscar otro artículo');
 const approved=confirmRow(row,products[3],0,true);expect(approved.billedQuantity).toBe(2);expect(approved.actualQuantity).toBe(0);expect(approved.product).toEqual(products[3]);expect(approved.resolvedFlags.length).toBeGreaterThan(0);expect(exportCsv([doc([approved])]).csv).toContain('"0","C3"');
});

it('keeps a known handwriting conflict classified as receipt uncertainty',()=>{
 const raw=fixture();raw.rows[1].flags=['conflicto_cantidad_manuscrita: 3 vs 5 impresa'];const row=buildInvoiceRows(raw,products)[1];expect(quantityReviewMessage(row)).toContain('anotaciones manuales');expect(quantityReviewMessage(row)).not.toContain('cantidad facturada a');
});
it('persists the independent printed geometry beside row diagnostics for review',()=>{
 const raw=fixture(),row=buildInvoiceRows(raw,products)[2];expect(row.quantityAlignment!.evidence).toEqual({baselines:[raw.quantityEvidence!.rows[2]],cells:[raw.quantityEvidence!.cells[2]]});
});
it('combines independent clear-check evidence with quantity geometry without letting a check resolve a billed shift',()=>{
 const raw=fixture();raw.annotationEvidence={rows:raw.quantityEvidence!.rows.map(r=>({...r,inspection:'complete' as const})),marks:raw.quantityEvidence!.cells.map(c=>({id:`check-${c.id}`,sourcePage:c.sourcePage,kind:'check' as const,text:null,quantity:null,position:c.position,candidateRows:c.candidateRows,anchorSupplierSku:c.anchorSupplierSku,association:'certain' as const}))};
 raw.rows[1].quantity=2;const rows=buildInvoiceRows(raw,products);expect(rows[1].annotationAssociation!.flags).toEqual([]);expect(rows[1].confirmed).toBe(false);expect(rows[1].proposedQuantity).toBeNull();expect(rows[4].confirmed).toBe(true);
});
it('validates flat and reverse-sloped layouts and keeps a separate photo usable',()=>{
 for(const slope of [0,-0.08])expect(buildInvoiceRows(fixture(slope),products).every(r=>r.confirmed)).toBe(true);
 const raw=fixture();raw.rows[4].sourcePage=2;raw.quantityEvidence!.rows[4].sourcePage=2;raw.quantityEvidence!.cells[4].sourcePage=2;raw.quantityEvidence!.cells[1].candidateRows=[3];
 const rows=buildInvoiceRows(raw,products);expect(rows[1].confirmed).toBe(false);expect(rows[2].confirmed).toBe(false);expect(rows[4].confirmed).toBe(true);
});

it('includes a contradicting independently printed key in the affected scope without merging good repeated occurrences',()=>{
 const raw=fixture();raw.quantityEvidence!.cells[2].anchorSupplierSku=raw.rows[1].supplierSku;
 const rows=buildInvoiceRows(raw,products);expect(rows.map(r=>r.confirmed)).toEqual([true,false,false,true,true]);expect(rows[1].billedQuantity).toBe(5);expect(rows[2].billedQuantity).toBe(7);
});
