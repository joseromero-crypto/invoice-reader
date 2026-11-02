import {it,expect} from 'vitest';
import {derivePrintedReading,selectPrintedQuantity,type PrintedReading} from '../shared/printed-reading';
import {encodePrintedTables,decodePrintedTables,columnsInvoiceRequest} from '../server/invoice-basic-columns';
import {readInvoiceOutput} from '../server/invoice-output';
import {buildInvoiceRows} from '../server/match-extraction';
import {needsSourceReview,exportCsv,type Product,type Document} from '../shared/domain';
import {initialReceivedQuantity} from '../shared/quantity-review';
const sizes=[{width:100,height:100,sourcePage:1}];
const product:Product={id:'p',sku:'LOCAL',supplier:'TEST',supplierSku:'00001',name:'Test pack 12',barcode:'000123',unit:'PZ'};
function source():PrintedReading{return {version:'invoice-basic-columns-v2',supplier:'TEST',reference:'0009',date:null,warnings:[],tables:[{id:1,sourcePage:1,quantityHeaders:['CAJAS','PIEZAS']}],rows:[{sourcePage:1,sourceRow:1,tableId:1,supplierSku:'00001',barcode:'000123',description:'Test pack 12',printedQuantities:['02','024'],printedUnit:'CAJAS',rawText:'00001 Test pack 12 02 024 CAJAS',fieldUncertainties:[],handwriting:{kind:'check_like',text:null,ownership:'row',candidateRows:[1]}}],coverage:[{sourcePage:1,inspection:'complete',content:'items',visibleRowCount:1,sourceRows:[1]}]};}
function read(value:unknown=encodePrintedTables(source())){return readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value),citations:null}]},sizes,'basic-v2');}
it('preserves literal columns and selects explicit printed pieces locally without multiplying packs',()=>{
 const input=source(),before=JSON.stringify(input),out=read(),rows=buildInvoiceRows(out,[product]);
 expect(out.printedReading).toEqual(input);expect(out.rows[0].quantity).toBe(24);expect(out.rows[0].unit).toBe('PIEZAS');expect(out.rows[0].packContents).toBeNull();
 expect(rows[0].proposedQuantity).toBe(24);expect(rows[0].flags).toEqual([]);expect(rows[0].confirmed).toBe(false);expect(rows[0].receptionMarked).toBe(false);expect(rows[0].actualQuantity).toBeNull();expect(rows[0].confirmedQuantity).toBeNull();
 expect(rows[0].sourceDetails?.printedSource).toEqual(input.rows[0]);expect(rows[0].sourceDetails?.quantityTable).toEqual(input.tables[0]);expect(rows[0].raw.quantityTable).toEqual(input.tables[0]);expect(rows[0].annotationAssociation).toBeUndefined();expect(JSON.stringify(input)).toBe(before);
 const doc:Document={id:'d',supplier:'TEST',reference:'SYNTHETIC',image:null,pages:1,expectedPages:null,warnings:[],printedTotal:null,rows};expect(needsSourceReview(doc)).toBe(true);expect(()=>exportCsv([doc],true)).toThrow(/fotos/);
});
it('does not guess among multiple/duplicate/unknown columns, even when numeric values coincide',()=>{
 for(const headers of [['CAJAS','CANTIDAD'],['PIEZAS','PZ'],[null,'CANTIDAD'],['CAJAS','PIEZAS TOTALES']])expect(selectPrintedQuantity(headers,['12','12'],'PZ')).toMatchObject({quantity:null,column:null});
 const input=source();input.tables[0].quantityHeaders=['CAJAS','CANTIDAD'];const rows=buildInvoiceRows(read(encodePrintedTables(input)),[product]);expect(initialReceivedQuantity(rows[0])).toBe('');expect(rows[0].billedQuantity).toBeNull();expect(rows[0].sourceDetails?.printedSource).toEqual(input.rows[0]);
});
it('retains sole billed columns and source units, allows zero, rejects ambiguous number formatting',()=>{
 expect(selectPrintedQuantity(['Cantidad'],['0'],'PQ')).toMatchObject({quantity:0,unit:'PQ',reason:null});
 expect(selectPrintedQuantity([null],['007'],'PAQUETE')).toMatchObject({quantity:7,unit:'PAQUETE'});
 for(const cell of ['1,234','1,5','12x2','-1','NaN','Infinity','',null])expect(selectPrintedQuantity(['PZ'],[cell],null)).toMatchObject({quantity:null});
 expect(selectPrintedQuantity(['Cantidad'],['7'],null)).toMatchObject({quantity:7,unit:null,reason:expect.any(String)});
 expect(selectPrintedQuantity(['CAJAS'],['7'],'PZ')).toMatchObject({quantity:null,reason:expect.any(String)});
});
it('round trips exact literal escapes, whitespace, nulls and punctuation without source normalization',()=>{
 const input=source();input.rows[0].supplierSku='~~0001';input.rows[0].rawText='literal "quote" \\ path';input.tables[0].quantityHeaders=[' CANTIDAD ','~PZ'];input.rows[0].printedQuantities=['1,000',null];
 expect(decodePrintedTables(encodePrintedTables(input))).toEqual(input);
});
it('rejects absent/extra fields, shifted cell lengths, invalid references/ownership/coverage and mixed modes',()=>{
 for(const mutate of [
  (s:any)=>s.extra=[],(s:any)=>s.tables[0].push('extra'),(s:any)=>s.tables.push(s.tables[0]),(s:any)=>s.tables[0][1]='2',
  (s:any)=>s.rows[0].pop(),(s:any)=>s.rows[0][5]='9',(s:any)=>s.rows[0][11]='0',(s:any)=>s.rows[0][11]='2',
  (s:any)=>s.rows[0][8]='check',(s:any)=>s.rows[0][12]='2',(s:any)=>s.uncertainties=[],(s:any)=>s.coverage[0][1]='incomplete',
 ]){const wire=encodePrintedTables(source());mutate(wire);expect(()=>read(wire)).toThrow();}
 expect(()=>readInvoiceOutput({stop_reason:'max_tokens',content:[]},sizes,'basic-v2')).toThrow(/complete/);
 const out=read();out.rows[0].quantity=2;expect(()=>buildInvoiceRows(out,[product])).toThrow(/adapter mismatch/);
 const drift=read();drift.printedReading!.rows[0].printedQuantities[1]='999';expect(()=>buildInvoiceRows(drift,[product])).toThrow(/adapter mismatch/);
 const mixed=read();mixed.readingMode='basic-v1';expect(()=>buildInvoiceRows(mixed,[product])).toThrow(/mode\/source/);
 expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(encodePrintedTables(source())),citations:null}]},sizes,'basic-v1')).toThrow(/explicit basic/);
});
it('keeps a doubtful printed count blank and handwritten count separate, never using it to approve',()=>{
 const input=source();input.rows[0].printedQuantities[1]=null;input.rows[0].handwriting={kind:'other',text:'24',ownership:'row',candidateRows:[1]};
 const out=read(encodePrintedTables(input)),rows=buildInvoiceRows(out,[product]);expect(rows[0].billedQuantity).toBeNull();expect(initialReceivedQuantity(rows[0])).toBe('');expect(rows[0].confirmed).toBe(false);expect(out.printedReading!.rows[0].handwriting.text).toBe('24');
});
it('keeps overlap coverage and genuine repeated rows distinct with localized ownership doubts',()=>{
 const input=source();input.rows.push({...structuredClone(input.rows[0]),sourceRow:2,handwriting:{kind:'none_seen',text:null,ownership:'row',candidateRows:[2]}});input.rows[0].handwriting={kind:'other',text:'?',ownership:'uncertain',candidateRows:[1,2]};input.coverage[0].sourceRows=[1,2];input.coverage[0].visibleRowCount=2;input.coverage.push({sourcePage:2,inspection:'complete',content:'items',visibleRowCount:1,sourceRows:[2]});
 const out=derivePrintedReading(input,2);expect(out.basic.rows).toHaveLength(2);expect(out.printed.coverage[1].sourceRows).toEqual([2]);
});
it('requests the explicit new native format and keeps supported no upfront thinking / low effort / one call',()=>{
 const image={type:'image',source:{type:'base64',media_type:'image/jpeg',data:'synthetic'}} as const;
 const req=columnsInvoiceRequest('claude-sonnet-5-5',[image],sizes,1);expect(req.output_config?.format?.schema.properties).toHaveProperty('tables');expect(req.output_config?.effort).toBe('low');expect(req.thinking).toEqual({type:'between_tools'});expect(req.tools).toBeUndefined();expect(req.max_tokens).toBe(6500);expect(req.system).not.toContain('00001');
});


// V2's paid response used T1 and candidateCount=0; keep that malformed shape
// rejected permanently. V3 moves IDs/enums and observations into native types.
import {encodePrintedTablesV3,decodePrintedTablesV3,columnsV3InvoiceRequest} from '../server/invoice-basic-columns-v3';
const readV3=(wire:unknown)=>readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(wire),citations:null}]},sizes,'basic-v3');
it('v3 native IDs/observations preserve the exact logical source and unconfirmed matching',()=>{
 const input=source(),wire=encodePrintedTablesV3(input);expect(decodePrintedTablesV3(wire)).toEqual(input);const out=readV3(wire),rows=buildInvoiceRows(out,[product]);expect(out.printedReading).toEqual(input);expect(rows[0].billedQuantity).toBe(24);expect(rows[0].flags).toEqual([]);expect(rows[0].confirmed).toBe(false);
 const escaped=source();escaped.tables[0].quantityHeaders=[null,'~PZ'];escaped.rows[0].printedQuantities=['01,2',null];escaped.rows[0].handwriting.text='~';expect(decodePrintedTablesV3(encodePrintedTablesV3(escaped))).toEqual(escaped);
});
it('v3 refuses malformed/missing ownership, unknown table IDs, duplicate observations and old versions',()=>{
 for(const mutate of [
  (w:any)=>w.tables[0].id='T1',(w:any)=>w.handwriting[0].candidateRows=[],(w:any)=>w.handwriting[0].candidateRows=[2],
  (w:any)=>w.handwriting[0].sourceRow=2,(w:any)=>w.handwriting.push(w.handwriting[0]),(w:any)=>w.handwriting=[],
  (w:any)=>w.rows[0].push('extra'),(w:any)=>w.rows[0][2]='T1',(w:any)=>w.handwriting[0].extra=1,(w:any)=>w.handwriting[0].kind='check',
 ]){const wire=encodePrintedTablesV3(source());mutate(wire);expect(()=>readV3(wire)).toThrow();}
 expect(()=>readV3(encodePrintedTables(source()))).toThrow(/v3/);
 const old=encodePrintedTables(source());old.tables[0][0]='T1';old.rows[0][5]='T1';old.rows[0][11]='0';old.rows[0].splice(12,1);expect(()=>read(old)).toThrow();
 const image={type:'image',source:{type:'base64',media_type:'image/jpeg',data:'synthetic'}} as const;
 const req=columnsV3InvoiceRequest('claude-sonnet-5-5',[image],sizes,1),schema=req.output_config?.format?.schema as any;
 expect(schema.properties.tables.items.properties.id.type).toBe('integer');expect(schema.properties.handwriting.items.properties.kind.enum).toContain('check_like');expect(req.thinking).toEqual({type:'between_tools'});expect(req.output_config?.effort).toBe('low');
});




it('requires source-key review for a contradictory key despite an exact barcode, keeping the count usable and raw key intact',()=>{
 const input=source();input.rows[0].supplierSku='50221300';input.rows[0].description='00001 Test pack 12';
 const parsed=readV3(encodePrintedTablesV3(input)),rows=buildInvoiceRows(parsed,[product]);
 expect(rows[0].flags).toContain('supplierSku: Clave leída distinta de la clave del catálogo para este código de barras; verifica la clave impresa.');expect(rows[0].supplierSku).toBe('50221300');expect(rows[0].raw.printedSource?.supplierSku).toBe('50221300');expect(initialReceivedQuantity(rows[0])).toBe('24');expect(rows[0].proposedQuantity).toBe(24);expect(rows[0].confirmed).toBe(false);
 const internal=[{id:'internal',external_id:product.id}],mappings=[{supplier:'TEST',supplier_sku:'50221300',product_id:'internal'}];expect(buildInvoiceRows(parsed,[product],internal,mappings)[0].flags).toEqual([]);
});




import {billedQuantityDisplay} from '../shared/quantity-review';
it('uses the same truthful billed label in list and detail, preserving zero and distinguishing unreadable from unselected',()=>{
 expect(billedQuantityDisplay({billedQuantity:0})).toBe(0);expect(billedQuantityDisplay({billedQuantity:null})).toBe('Ilegible');
 expect(billedQuantityDisplay({billedQuantity:null,sourceDetails:{printedSource:{printedQuantities:['4.00','4.00']}}})).toBe('Sin seleccionar');
 expect(billedQuantityDisplay({billedQuantity:null,sourceDetails:{printedSource:{printedQuantities:[null,' ']}}})).toBe('Ilegible');
});
