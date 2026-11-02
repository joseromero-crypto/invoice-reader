import {encodeBasicTables,decodeBasicTables} from '../server/invoice-basic-tables';
import {it,expect,vi} from 'vitest';
import {BasicReadingSchema,validateBasicReading} from '../shared/basic-reading';
import {readInvoiceOutput} from '../server/invoice-output';
import {basicInvoiceRequest} from '../server/invoice-basic';
import {buildInvoiceRows} from '../server/match-extraction';
import {confirmRow,exportCsv,type Product,type Document,type Row} from '../shared/domain';
import {initialReceivedQuantity,validReceivedQuantity} from '../shared/quantity-review';
import {DOCUMENT_BUDGET_USD,invoiceSpendPreflight,priorDocumentSpend,reserveDocumentCall,reconcileDocumentCall,documentEstimatedCost} from '../server/invoice-spend';
import type Anthropic from '@anthropic-ai/sdk';
const sizes=[{sourcePage:1,width:100,height:100}];
const products:Product[]=Array.from({length:3},(_,i)=>({id:String(i),sku:'C'+i,name:'Product '+i,supplier:'TEST',supplierSku:'000'+i,barcode:null,unit:'PZ'}));
const source=()=>({version:'invoice-basic-v1',supplier:'TEST',reference:'000001',date:null,warnings:[],rows:products.map((p,i)=>({sourcePage:1,sourceRow:i+1,supplierSku:p.supplierSku,barcode:null,description:p.name,quantity:i+1,unit:'PZ',rawText:`${p.supplierSku} ${p.name} ${i+1} PZ`,fieldUncertainties:[],handwriting:{kind:'check_like',text:null,ownership:'row',candidateRows:[i+1]}})),coverage:[{sourcePage:1,inspection:'complete',content:'items',visibleRowCount:3,sourceRows:[1,2,3]}]});
function read(value:any=source()){return readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value),citations:null}]},sizes,'basic-v1');}
const doc=(rows:Row[]):Document=>({id:'d',supplier:'TEST',reference:'TEST',image:null,pages:1,expectedPages:null,warnings:[],printedTotal:null,rows});
it('preserves basic source exactly without pretending to supply detailed evidence or confirming checks',()=>{
 const input=source(),before=JSON.stringify(input),parsed=read(input),rows=buildInvoiceRows(parsed,products);
 expect('basicReading' in parsed&&parsed.basicReading).toEqual(input);expect(parsed.annotationEvidence).toBeUndefined();expect(rows[0].annotationAssociation).toBeUndefined();expect(rows[0].quantityAlignment).toBeUndefined();expect(parsed.quantityEvidence).toBeUndefined();
 expect(rows).toHaveLength(3);expect(rows.every(r=>!r.flags.length&&!r.confirmed&&r.confirmedQuantity===null&&r.actualQuantity===null&&!r.receptionMarked)).toBe(true);
 expect(rows[0].supplierSku).toBe('0000');expect(JSON.stringify(input)).toBe(before);
 expect(()=>exportCsv([doc(rows)],true,true)).toThrow(/Confirma/);
});
it('leaves doubtful counts blank, propagates ownership only to specified rows and accepts explicit zero after human input',()=>{
 const input:any=source();input.rows[0].handwriting={kind:'other',text:'0?',ownership:'uncertain',candidateRows:[1,2]};
 const rows=buildInvoiceRows(read(input),products);expect(rows.slice(0,2).every(r=>initialReceivedQuantity(r)===''&&r.flags.length>0)).toBe(true);expect(rows[2].flags).toEqual([]);
 expect(initialReceivedQuantity(rows[2])).toBe('3');expect(validReceivedQuantity('')).toBe(false);expect(validReceivedQuantity('0')).toBe(true);
 const reviewed=confirmRow(rows[0],products[0],0,true);expect(reviewed.billedQuantity).toBe(1);expect(reviewed.confirmedQuantity).toBe(0);expect(rows[0].confirmed).toBe(false);
 expect(()=>exportCsv([doc([reviewed])],false)).toThrow(/fotos/);expect(exportCsv([doc([reviewed])],false,true).csv).toContain('"0","C0","0000"');
});
it('keeps identity doubts separate from physical count proposals, and unit/count doubts require individual count input',()=>{
 const input:any=source();input.rows[0].fieldUncertainties=[{field:'supplierSku',reason:'one digit obscured'}];input.rows[1].fieldUncertainties=[{field:'unit',reason:'unit obscured'}];input.rows[2].quantity=null;
 const rows=buildInvoiceRows(read(input),products);expect(rows[0].flags).toContain('supplierSku: one digit obscured');expect(initialReceivedQuantity(rows[0])).toBe('1');expect(initialReceivedQuantity(rows[1])).toBe('');expect(initialReceivedQuantity(rows[2])).toBe('');
});
it('rejects unknown or absent fields, invalid enums, duplicate/unknown/out of order references and incomplete coverage',()=>{
 for(const mutate of [
  (s:any)=>s.extra=[],(s:any)=>delete s.rows[0].handwriting,(s:any)=>s.rows[0].handwriting.kind='check',
  (s:any)=>s.rows[0].sourceRow=2,(s:any)=>s.rows[0].sourcePage=2,(s:any)=>s.rows.reverse(),
  (s:any)=>s.coverage=[],(s:any)=>s.coverage[0].inspection='incomplete',(s:any)=>s.coverage[0].visibleRowCount=4,
  (s:any)=>s.coverage[0].sourceRows=[1,1,3],(s:any)=>s.rows[0].handwriting.candidateRows=[4],
  (s:any)=>s.rows[0].handwriting={kind:'none_seen',text:'2',ownership:'row',candidateRows:[1]},
  (s:any)=>s.rows[0].handwriting.candidateRows=[],
 ]){const input:any=source();mutate(input);expect(()=>read(input)).toThrow();}
 expect(()=>readInvoiceOutput({stop_reason:'max_tokens',content:[]},sizes,'basic-v1')).toThrow(/complete/);
 expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:'{"invoice":"{}"}',citations:null}]},sizes,'basic-v1')).toThrow(/explicit basic/);
});
it('accounts for fiscal pages and overlapping originals without duplicated items',()=>{
 const input:any=source();input.coverage.push({sourcePage:2,inspection:'complete',content:'items',visibleRowCount:2,sourceRows:[2,3]},{sourcePage:3,inspection:'complete',content:'non_items',visibleRowCount:0,sourceRows:[]});expect(validateBasicReading(input,3).rows).toHaveLength(3);
});
const image={type:'image',source:{type:'base64',media_type:'image/jpeg',data:'synthetic'}} as Anthropic.ImageBlockParam;
it('uses supported Sonnet low between_tools with full overviews and bounded details and rejects other models',()=>{
 const request=basicInvoiceRequest('claude-sonnet-5-5',[image],sizes,1);expect(request.thinking).toEqual({type:'between_tools'});expect(request.output_config?.effort).toBe('low');expect(request.max_tokens).toBeLessThanOrEqual(16000);expect(request.tools).toBeUndefined();
 expect(()=>basicInvoiceRequest('claude-haiku-5-5',[image],sizes,1)).toThrow();expect(()=>basicInvoiceRequest('claude-sonnet-5-5',[image],[{...sizes[0],region:{left:0,top:0,width:50,height:50}}],1)).toThrow(/overview/);
});
it('reserves padded input and useful maximum output against the remaining shared balance',async()=>{
 const client={messages:{countTokens:vi.fn().mockResolvedValue({input_tokens:20000})}} as unknown as Anthropic;
 const request=basicInvoiceRequest('claude-sonnet-5-5',[image],sizes,1);
 const reservation=await invoiceSpendPreflight(client,request);expect(DOCUMENT_BUDGET_USD).toBe(0.099);expect(reservation.reservedInputTokens).toBe(25024);expect(reservation.maxOutputTokens).toBe(4894);expect(reservation.reservedUSD).toBeLessThanOrEqual(.099);
 const spend=reserveDocumentCall(priorDocumentSpend(null,0),1,reservation);
 const restored=priorDocumentSpend(JSON.parse(JSON.stringify({documentSpend:spend})),1);expect(documentEstimatedCost(restored)).toBe(reservation.reservedUSD);
 await expect(invoiceSpendPreflight(client,basicInvoiceRequest('claude-sonnet-5-5',[image],sizes,1),restored)).rejects.toThrow(/presupuesto/);
 reconcileDocumentCall(spend,{input_tokens:20000,output_tokens:1000,cache_creation_input_tokens:0,cache_read_input_tokens:0} as Anthropic.Usage,'claude-sonnet-5-5');expect(documentEstimatedCost(spend)).toBe(.05);
 const smallClient={messages:{countTokens:vi.fn().mockResolvedValue({input_tokens:1000})}} as unknown as Anthropic;
 const next=await invoiceSpendPreflight(smallClient,basicInvoiceRequest('claude-sonnet-5-5',[image],sizes,1),spend);expect(next.reservedUSD+.05).toBeLessThanOrEqual(.099);expect(reserveDocumentCall(spend,2,next).calls).toHaveLength(2);
});
it('carries v1 unknown reservations forward without resetting jobs or losing charges',()=>{
 const legacy:any={policy:'invoice-spend-v1',calls:[{attempt:1,reservation:{policy:'invoice-spend-v1',reservedUSD:.025},estimatedActualUSD:null,usage:null}]};const restored=priorDocumentSpend({documentSpend:legacy},1);expect(documentEstimatedCost(restored)).toBe(.025);expect(restored.calls[0]).toEqual(legacy.calls[0]);
});

it('compact basic transport preserves every logical field, source escapes, nulls and explicit empty uncertainties',()=>{
 const value:any=source();value.rows[0].supplierSku='~~0001';value.rows[0].barcode='';value.rows[0].quantity=0;value.rows[0].handwriting.text='~';value.rows[1].supplierSku=null;value.rows[1].rawText='literal \"quote\" \\ path';
 const wire=encodeBasicTables(value);expect(decodeBasicTables(wire)).toEqual(value);expect('basicReading' in read(wire)&&read(wire).basicReading).toEqual(value);
 for(const mutate of [(s:any)=>s.rows[0].pop(),(s:any)=>s.uncertainties.pop(),(s:any)=>s.rows[0][5]='NaN',(s:any)=>s.uncertainties.push(['999']),(s:any)=>s.rows[0][8]='check',(s:any)=>s.extra=[]]){const bad=structuredClone(wire);mutate(bad);expect(()=>read(bad)).toThrow();}
});

it('does not prefill physical counts from unverified case conversion and refuses reset spend history',()=>{
 const input:any=source();input.rows[0].unit='CAJAS';const rows=buildInvoiceRows(read(input),products);expect(initialReceivedQuantity(rows[0])).toBe('');expect(rows[0].billedQuantity).toBe(1);expect(()=>priorDocumentSpend({documentSpend:{policy:'invoice-spend-v2',calls:[{attempt:1}]}},0)).toThrow(/reset/);
});

it('rejects basic adapter drift and retains the exact per-row basic source including unit doubts',()=>{
 const input:any=source();input.rows[0].fieldUncertainties=[{field:'unit',reason:'source unit unclear'}];const parsed=read(input);const rows=buildInvoiceRows(parsed,products);expect(rows[0].raw.basicSource).toEqual(input.rows[0]);expect(rows[0].sourceDetails?.fieldUncertainties).toEqual(input.rows[0].fieldUncertainties);parsed.rows[0].quantity=999;expect(()=>buildInvoiceRows(parsed,products)).toThrow(/adapter mismatch/);
});

it('retains separate physical occurrences of the same printed product without merging them',()=>{
 const input:any=source();input.rows[1]={...structuredClone(input.rows[0]),sourceRow:2,handwriting:{kind:'other',text:null,ownership:'row',candidateRows:[2]}};const rows=buildInvoiceRows(read(input),products);expect(rows).toHaveLength(3);expect(rows[0].product?.id).toBe(rows[1].product?.id);expect(rows[0].sourceRow).not.toBe(rows[1].sourceRow);expect(rows[0].flags).toEqual([]);expect(initialReceivedQuantity(rows[1])).toBe('');
});

it('requires paired basic mode/source, rejects mixed inventories, and derives doubts from preserved basic source',()=>{
 const parsed=read();const noMode=structuredClone(parsed);delete noMode.readingMode;expect(()=>buildInvoiceRows(noMode,products)).toThrow(/mode required/);
 const mixed=structuredClone(parsed);mixed.annotationEvidence={rows:[],marks:[]};expect(()=>buildInvoiceRows(mixed,products)).toThrow(/impersonate/);
 parsed.basicReading!.rows[0].fieldUncertainties=[{field:'quantity',reason:'physical baseline uncertain'}];parsed.rows[0].fieldUncertainties=[];expect(initialReceivedQuantity(buildInvoiceRows(parsed,products)[0])).toBe('');
});
