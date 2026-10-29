import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Review from '../src/Review';
import {ExtractionSchema,confirmRow,exportCsv,type Product,type Row,type Document} from '../shared/domain';
import {buildInvoiceRows} from '../server/match-extraction';
import {initialReceivedQuantity,needsQuantityInput,quantityReviewMessage,validReceivedQuantity} from '../shared/quantity-review';
const products:Product[]=[1,2,3].map(i=>({id:String(i),sku:`ITEM${i}`,name:`Postre de prueba ${i}`,supplier:'Synthetic',supplierSku:`KEY${i}`,barcode:null,unit:'pz'}));
function extraction(kind='changed_quantity',text:string|null='?',quantity:number|null=null){return ExtractionSchema.parse({supplier:'Synthetic',reference:'TEST',date:null,currency:null,printedPage:null,printedPageCount:null,printedTotal:null,warnings:[],rows:products.map((p,i)=>({sourceRow:i+1,sourcePage:1,supplierSku:p.supplierSku,barcode:null,description:p.name,quantity:12,unit:'PZ',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:`${p.supplierSku} ${p.name} 12 PZ`,flags:[],reception:i===1?{kind,text,quantity}:{kind:'check',text:null,quantity:null},receptionMarked:true}))});}
const document=(rows:Row[]):Document=>({id:'d',reference:'TEST',supplier:'Synthetic',image:null,pages:1,expectedPages:null,printedTotal:null,warnings:[],rows});
const render=(row:Row)=>renderToStaticMarkup(createElement(Review,{row,products,onClose:()=>{},onConfirm:async()=>{},imageSrc:'',mode:'synthetic'}));
it('keeps matched item identity while withholding received quantity for all non-check annotations',()=>{
 for(const kind of ['changed_quantity','same_quantity','cross','circle','return','ambiguous','signature']){
  const raw=extraction(kind,kind==='same_quantity'?'12':'?',kind==='same_quantity'?12:null),before=JSON.stringify(raw);const rows=buildInvoiceRows(raw,products),row=rows[1];
  expect(row.product).toEqual(products[1]);expect(row.billedQuantity).toBe(12);expect(row.proposedQuantity).toBe(12);expect(row.actualQuantity).toBeNull();expect(row.confirmed).toBe(false);expect(needsQuantityInput(row)).toBe(true);expect(initialReceivedQuantity(row)).toBe('');expect(JSON.stringify(raw)).toBe(before);
 }
});
it('shows a named manual-entry prompt, billed count separately, an empty required input and disabled confirmation',()=>{
 const row=buildInvoiceRows(extraction(),products)[1],html=render(row);
 expect(html).toContain('Indica las piezas recibidas.');expect(html).toContain('Postre de prueba 2');expect(html).toContain('Cantidad facturada:');expect(html).toContain('No necesitas descifrar ni sumar');
 const input=html.match(/<input[^>]*id="actual-pieces"[^>]*>/)![0];expect(input).toContain('value=""');expect(input).toContain('required=""');expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Confirmar artículo y piezas/s);expect(html).not.toContain('Verifica el artículo y la presentación');
});
it('accepts an explicitly typed zero but never interprets empty, whitespace, fractions or negative input as zero',()=>{
 for(const value of ['', ' ', '-1', '1.5', '1e2', 'NaN', '1000001'])expect(validReceivedQuantity(value)).toBe(false);
 for(const value of ['0','7','1000000'])expect(validReceivedQuantity(value)).toBe(true);
});
it('resolves receipt with a physical count without resolving or rewriting unreadable handwriting',()=>{
 const raw=extraction('ambiguous','overwritten ? + ?',null),rows=buildInvoiceRows(raw,products),row=rows[1];const before=JSON.stringify(raw);
 expect(()=>confirmRow(row,row.product!,7,false)).toThrow();const reviewed=confirmRow(row,row.product!,7,true);
 expect(reviewed.actualQuantity).toBe(7);expect(reviewed.confirmedQuantity).toBe(7);expect(reviewed.billedQuantity).toBe(12);expect(reviewed.product).toEqual(row.product);expect(reviewed.resolvedFlags.length).toBeGreaterThan(0);expect(reviewed.flags).toEqual([]);expect(initialReceivedQuantity(reviewed)).toBe('7');expect(JSON.stringify(raw)).toBe(before);
 expect(exportCsv([document([reviewed])]).csv).toContain('"7","ITEM2"');
});
it('requires manual count for each plausible neighboring item and leaves other items usable',()=>{
 const rows=buildInvoiceRows(extraction('changed_quantity','7',7),products);expect(rows.every(needsQuantityInput)).toBe(true); // legacy numeric note with no row location
 const first=confirmRow(rows[0],rows[0].product!,2,true);const partial=exportCsv([document([first,...rows.slice(1)])],true);expect(partial.excluded).toEqual(['TEST / 2','TEST / 3']);expect(partial.csv).not.toContain('ITEM2');expect(partial.csv).not.toContain('ITEM3');
 const clear=buildInvoiceRows(extraction('cross','X',null),products);expect(clear[0].confirmed).toBe(true);expect(clear[2].confirmed).toBe(true);expect(initialReceivedQuantity(clear[1])).toBe('');
});
it('retains identity warnings as a separate decision alongside manual quantity entry',()=>{
 const raw=extraction('circle','circle',null);raw.rows[1].description='Postre chocolate 100g';const catalog=products.map((p,i)=>i===1?{...p,name:'Postre fresa 900g'}:p),row=buildInvoiceRows(raw,catalog)[1];
 expect(needsQuantityInput(row)).toBe(true);expect(row.flags).toContain('Presentación o contenido distinto');expect(render(row)).toContain('Verifica el artículo y la presentación');expect(initialReceivedQuantity(row)).toBe('');
});
it('preserves automatic confirmation of eligible clear checks and their neighbors',()=>{
 const rows=buildInvoiceRows(extraction('check',null,null),products);expect(rows.every(r=>r.confirmed)).toBe(true);expect(rows.every(r=>!needsQuantityInput(r))).toBe(true);expect(initialReceivedQuantity(rows[0])).toBe('12');
});
it('explains uncertain association or incomplete inspection without inventing a certain annotation assignment',()=>{
 const row=buildInvoiceRows(extraction('changed_quantity','7',7),products)[0];expect(quantityReviewMessage(row)).toContain('asociación');
 const incomplete={...row,flags:['Recepción pendiente: inspección de manuscritos incompleta.']};expect(quantityReviewMessage(incomplete)).toContain('No se pudo verificar si');expect(quantityReviewMessage(incomplete)).not.toContain('Se detectaron');
});
it('exports an explicitly confirmed zero while keeping the billed count and audit reasons',()=>{
 const row=buildInvoiceRows(extraction('return','returned',null),products)[1],reviewed=confirmRow(row,row.product!,0,true);
 expect(reviewed.billedQuantity).toBe(12);expect(reviewed.actualQuantity).toBe(0);expect(reviewed.resolvedFlags.length).toBeGreaterThan(0);expect(exportCsv([document([reviewed])]).csv).toContain('"0","ITEM2"');
});

it('can retain a description-only product proposal without inventing source identifiers or a received count',()=>{
 const raw=extraction('ambiguous','?',null);raw.rows[1].supplierSku=null;raw.rows[1].barcode=null;const row=buildInvoiceRows(raw,[products[1]])[1];
 expect(row.product?.id).toBe(products[1].id);expect(row.supplierSku).toBeNull();expect(row.barcode).toBeNull();expect(initialReceivedQuantity(row)).toBe('');expect(row.confirmed).toBe(false);
});
