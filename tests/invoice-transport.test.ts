import {describe,it,expect} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {encodeInvoiceTransport,decodeInvoiceTransport,invoiceTransportContract} from '../server/invoice-transport';
import {invoiceRequest} from '../server/invoice-request';
import {invoiceExtractionInstructions,invoiceOutputFormat,invoiceRequestOptions,readInvoiceOutput} from '../server/invoice-output';
import {buildInvoiceRows} from '../server/match-extraction';

const baseline={start:{x:0,y:0.2},end:{x:0.8,y:0.4}};
const fixture={
 supplier:'Synthetic supplier',reference:'00017',date:'2024-02-29',currency:null,printedPage:null,printedPageCount:null,printedTotal:null,warnings:['Verificar anotación.'],
 annotationEvidence:{rows:[{sourceRow:1,sourcePage:1,inspection:'complete',baseline}],marks:[{id:'m1',sourcePage:1,kind:'changed_quantity',text:' 0 + ? " \\ \n ñ ',quantity:null,position:{x:1,y:0.45},candidateRows:[1,2],anchorSupplierSku:'0012',association:'ambiguous'}]},
 quantityEvidence:{rows:[{sourceRow:1,sourcePage:1,baseline}],cells:[{id:'c1',sourcePage:1,text:'00',value:0,position:{x:1,y:0.45},candidateRows:[1],anchorSupplierSku:'0012',association:'certain'}]},
 rows:[{sourcePage:1,sourceRow:1,supplierSku:'0012',barcode:'0000000000001',description:'  Synthetic 4-pack ñ " \\ ',quantity:0,unit:'PZ',packContents:4,price:'000.00',discount:null,tax:null,amount:null,rawText:' 0012  Synthetic  0 + ?\n',reception:{kind:'ambiguous',text:'0 + ?',quantity:null},fieldUncertainties:[{field:'quantity',reason:'Verificar asociación.'}],receptionMarked:false,flags:['Anotación sin resolver.']}]
};
// A second real source-row occurrence makes competing ownership meaningful.
fixture.rows.push({...fixture.rows[0],sourceRow:2,supplierSku:'0013',quantity:5,reception:{kind:'none',text:'',quantity:null},receptionMarked:false,fieldUncertainties:[],flags:[]});
const secondBaseline={start:{x:0,y:0.6},end:{x:0.8,y:0.8}};
fixture.annotationEvidence.rows.push({sourceRow:2,sourcePage:1,inspection:'complete',baseline:secondBaseline});
fixture.quantityEvidence.rows.push({sourceRow:2,sourcePage:1,baseline:secondBaseline});
fixture.quantityEvidence.cells.push({id:'c2',sourcePage:1,text:'5',value:5,position:{x:1,y:0.85},candidateRows:[2],anchorSupplierSku:'0013',association:'certain'});
const response=(inner:unknown)=>({stop_reason:'end_turn' as const,content:[{type:'text' as const,text:JSON.stringify({invoice:JSON.stringify(inner)}),citations:null}]});
const read=(inner:unknown)=>readInvoiceOutput(response(inner));
describe('lossless compact invoice transport',()=>{
 it('preserves every source value, independent inventory, exact coordinate and receiving decision',()=>{
  const wire=encodeInvoiceTransport(fixture);
  expect(wire[0]).toBe(1);
  expect(decodeInvoiceTransport(wire)).toEqual(fixture);
  expect(read(wire)).toEqual(read(fixture));
  const decisions=(value:unknown)=>buildInvoiceRows(read(value),[]).map(({id,...row})=>row);
  expect(decisions(wire)).toEqual(decisions(fixture));
  expect(JSON.stringify(response(wire))).not.toContain('sourceRow');
 });
 it('keeps object field order stable when the input object is reordered',()=>{
  const reverse=(v:any):any=>Array.isArray(v)?v.map(reverse):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])):v;
  expect(encodeInvoiceTransport(reverse(fixture))).toEqual(encodeInvoiceTransport(fixture));
 });
 it('rejects missing or added positions in every kind of tuple, including null-only positions',()=>{
  const paths=[[],[8],[8,0,0],[8,0,0,3],[8,0,0,3,0],[8,1,0],[8,1,0,5],[9],[9,0,0],[9,1,0],[10,0],[10,0,13],[10,0,14,0]];
  for(const path of paths)for(const change of ['remove','add']){
   const wire:any=encodeInvoiceTransport(fixture);
   const target=path.reduce((v:any,k:number)=>v[k],wire[1]);
   if(change==='remove')target.pop();else target.push(null);
   expect(()=>read(wire),`${path} ${change}`).toThrow();
  }
 });
 it('rejects unsupported versions, malformed roots and required observations replaced with null',()=>{
  for(const bad of [[2,[]],[1],['1',[]],[1,[],null],[1,null],[1,{}]])expect(()=>read(bad)).toThrow();
  for(const path of [[8],[9],[10],[10,0,13],[10,0,14],[10,0,15]]){
   const wire:any=encodeInvoiceTransport(fixture);
   const parent=path.slice(0,-1).reduce((v:any,k:number)=>v[k],wire[1]);parent[path.at(-1)!]=null;
   expect(()=>read(wire)).toThrow();
  }
 });
 it('validates original types, calendar, geometry and enums after decoding; never substitutes defaults',()=>{
  const invalid=[{...fixture,date:'2026-02-29'},{...fixture,rows:[{...fixture.rows[0],quantity:'0'}]},
   {...fixture,rows:[{...fixture.rows[0],reception:{kind:'approved',text:null,quantity:null}}]},
   {...fixture,annotationEvidence:{...fixture.annotationEvidence,rows:[{sourceRow:1,sourcePage:1,inspection:'complete',baseline:{start:{x:-0.1,y:0},end:{x:1,y:0}}}]}}];
  for(const bad of invalid)expect(()=>read(encodeInvoiceTransport(bad))).toThrow();
  for(const missing of ['reception','receptionMarked','fieldUncertainties']){
   const bad:any=structuredClone(fixture);delete bad.rows[0][missing];expect(()=>encodeInvoiceTransport(bad)).toThrow();
  }
  expect(()=>encodeInvoiceTransport({...fixture,extra:true})).toThrow();
 });
 it('rejects partial/refused compact responses and never turns them into usable rows',()=>{
  const valid=response(encodeInvoiceTransport(fixture));
  for(const stop_reason of ['max_tokens','refusal'] as const)expect(()=>readInvoiceOutput({...valid,stop_reason})).toThrow();
  expect(()=>readInvoiceOutput({...valid,content:[{...valid.content[0],text:valid.content[0].text.slice(0,-2)}]})).toThrow();
 });
 it('sends the measured effort profile through the actual SDK, within unchanged caps and native grammar',async()=>{
  for(const pages of [1,2,3,5,8]){
   let sent:any,calls=0;
   const client=new Anthropic({apiKey:'synthetic-key',maxRetries:0,timeout:300000,fetch:async(_url,init)=>{
    calls++;sent=JSON.parse(String(init?.body));
    return Response.json({id:'synthetic',type:'message',role:'assistant',model:'claude-sonnet-5-5',...response(encodeInvoiceTransport(fixture)),stop_sequence:null,usage:{input_tokens:10,output_tokens:20}});
   }});
   const images=Array.from({length:pages},()=>({type:'image' as const,source:{type:'base64' as const,media_type:'image/jpeg' as const,data:'synthetic'}}));
   const result=await client.messages.create(invoiceRequest('claude-sonnet-5-5',images,'adaptive',images.map(()=>({width:100,height:100}))));
   expect(calls).toBe(1);expect(sent.max_tokens).toBe(pages<3?16000:32000);
   expect(sent.output_config.effort).toBe(pages<=4?'high':'medium');expect(sent.output_config.format).toEqual(invoiceOutputFormat());
   expect(sent.thinking).toBeUndefined();expect(sent.temperature).toBeUndefined();expect(sent.tools).toBeUndefined();
   expect(readInvoiceOutput(result)).toEqual(fixture);
  }
 });
 it('serializes an explicit no-up-front-thinking diagnostic only for the supported model',async()=>{
  let sent:any,calls=0;
  const client=new Anthropic({apiKey:'synthetic-key',maxRetries:0,timeout:180000,fetch:async(_url,init)=>{
   calls++;sent=JSON.parse(String(init?.body));
   return Response.json({id:'synthetic',type:'message',role:'assistant',model:'claude-sonnet-5-5',...response(encodeInvoiceTransport(fixture)),stop_sequence:null,usage:{input_tokens:10,output_tokens:20}});
  }});
  const images=[{type:'image' as const,source:{type:'base64' as const,media_type:'image/jpeg' as const,data:'synthetic'}}];
  const result=await client.messages.create(invoiceRequest('claude-sonnet-5-5',images,'between_tools',[{width:100,height:100}]));
  expect(calls).toBe(1);expect(sent.max_tokens).toBe(16000);expect(sent.thinking).toEqual({type:'between_tools'});
  expect(sent.output_config.effort).toBe('medium');expect(sent.output_config.format).toEqual(invoiceOutputFormat());
  expect(readInvoiceOutput(result)).toEqual(fixture);
  expect(()=>invoiceRequestOptions(1,'synthetic','between_tools')).toThrow('requires Sonnet 5.5');
  expect(invoiceRequestOptions(1,'claude-sonnet-5-5').thinking).toBeUndefined();
 });
 it('generates an unambiguous typed layout and valid encoding example, with no fabricated source defaults',()=>{
  const text=invoiceExtractionInstructions(2);
  expect(text).toContain('Point = [x:number');expect(text).toContain('Row = [sourcePage:integer');
  expect(text).toContain('valid calendar YYYY-MM-DD');expect(text).toContain('changed_quantity');expect(text).toContain('independent evidence inventories');
  const example=text.split('Encoding example only: ')[1].split('. The example')[0];
  expect(JSON.parse(example).meta).toEqual(['','0001','','','','','']);
  expect(()=>invoiceTransportContract({type:'object',properties:{extra:{type:'string'}}})).toThrow('mismatch');
 });
});
