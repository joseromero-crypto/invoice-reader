import {describe,it,expect} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {invoiceRequestOptions,invoiceExtractionInstructions,invoiceOutputFormat,readInvoiceOutput} from '../server/invoice-output';
const invoice={supplier:'Synthetic supplier',reference:'00017',date:'2026-10-26',currency:'MXN',printedPage:1,printedPageCount:1,printedTotal:null,warnings:[],quantityEvidence:{rows:[],cells:[]},annotationEvidence:{rows:[{sourceRow:1,sourcePage:1,inspection:'complete',baseline:null}],marks:[]},rows:[{sourcePage:1,sourceRow:1,supplierSku:'0012',barcode:null,description:'Synthetic product',quantity:3,unit:'pieza',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:'0012 Synthetic product 3',reception:{kind:'none',text:null,quantity:null},fieldUncertainties:[],receptionMarked:false,flags:[]}]};
const rawContent=(value:unknown)=>[{type:'text' as const,text:JSON.stringify(value),citations:null}];
const content=(value:unknown)=>rawContent({invoice:JSON.stringify(value)});
const read=(value:unknown)=>readInvoiceOutput({stop_reason:'end_turn',content:content(value)});
describe('invoice response envelope',()=>{
 it('serializes the actual SDK request with a small native envelope and the complete domain contract in the prompt',async()=>{
  let sent:any;
  const client=new Anthropic({apiKey:'synthetic-key',maxRetries:0,timeout:300000,fetch:async(_url,init)=>{sent=JSON.parse(String(init?.body));return Response.json({id:'synthetic',type:'message',role:'assistant',model:'synthetic',content:content(invoice),stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:20}});}});
  const response=await client.messages.create({model:'synthetic',...invoiceRequestOptions(5),messages:[{role:'user',content:invoiceExtractionInstructions(5)}]});
  expect(sent.max_tokens).toBe(32000);expect(invoiceRequestOptions(1).max_tokens).toBe(16000);
  expect(sent.output_config.format.type).toBe('json_schema');
  expect(sent.output_config.format.schema.required).toEqual(['invoice']);
  expect(sent.output_config.format.schema.additionalProperties).toBe(false);
  expect(JSON.stringify(sent.output_config.format.schema).length).toBeLessThan(1024);
  expect(sent.tools).toBeUndefined();expect(sent.output_format).toBeUndefined();
  const prompt=sent.messages[0].content;
  for(const field of ['annotationEvidence','quantityEvidence','reception','fieldUncertainties','receptionMarked'])expect(prompt).toContain(field);
  expect(prompt).toContain('independent evidence inventories');expect(prompt).toContain('domain schema');
  expect(readInvoiceOutput(response)).toEqual(invoice);
 });
 it('rejects incomplete or ambiguous responses even if their envelope parses',()=>{
  for(const stop_reason of ['refusal','max_tokens'] as const)expect(()=>readInvoiceOutput({stop_reason,content:content(invoice)})).toThrow();
  for(const blocks of [[],[...content(invoice),...content(invoice)],[{type:'text' as const,text:'broken',citations:null}]])expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:blocks})).toThrow();
 });
 it('rejects malformed, double encoded, missing or extra envelope fields',()=>{
  for(const value of [null,[],3,{},invoice,{invoice:invoice},{invoice:'broken'},{invoice:JSON.stringify(invoice),extra:true},{invoice:JSON.stringify(JSON.stringify(invoice))}]){
   expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:rawContent(value)})).toThrow();
  }
  expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:'```json\n'+JSON.stringify({invoice:JSON.stringify(invoice)})+'\n```',citations:null}]})).toThrow();
 });
 it('requires both independent inventories and every fresh row observation',()=>{
  for(const key of ['annotationEvidence','quantityEvidence']){
   const value={...invoice} as any;delete value[key];expect(()=>read(value)).toThrow();
  }
  for(const key of ['reception','fieldUncertainties','receptionMarked']){
   const row={...invoice.rows[0]} as any;delete row[key];expect(()=>read({...invoice,rows:[row]})).toThrow();
  }
  expect(()=>read({...invoice,rows:[]})).toThrow();
 });
 it('rejects nested unknown fields and missing required source fields before rows are usable',()=>{
  for(const value of [
   {...invoice,extra:true},
   {...invoice,rows:[{...invoice.rows[0],invented:true}]},
   {...invoice,quantityEvidence:{rows:[],cells:[],invented:true}},
   {...invoice,rows:[{...invoice.rows[0],reception:{kind:'none',text:null}}]},
   {...invoice,annotationEvidence:{...invoice.annotationEvidence,rows:[{...invoice.annotationEvidence.rows[0],invented:true}]}}
  ])expect(()=>read(value)).toThrow();
 });
 it('preserves zero, null, exact source strings, leading zeros and geometry without transport placeholders',()=>{
  const value={...invoice,supplier:'',reference:'00017',printedPage:null,rows:[{...invoice.rows[0],quantity:0,packContents:4,price:'000.00',rawText:'  0012  Producto 0  '}],quantityEvidence:{rows:[{sourceRow:1,sourcePage:1,baseline:{start:{x:0,y:0.2},end:{x:0.8,y:0.4}}}],cells:[{id:'c1',sourcePage:1,text:'00',value:0,position:{x:1,y:0.45},candidateRows:[1],anchorSupplierSku:'0012',association:'certain'}]}};
  expect(read(value)).toEqual(value);
  const unknown={...invoice,rows:[{...invoice.rows[0],supplierSku:null,barcode:null,quantity:null}]};expect(read(unknown)).toEqual(unknown);
 });
 it('enforces original calendar, enum, type and numeric bounds after envelope decoding',()=>{
  for(const value of [
   ...['2026-02-29','2026-13-01','26/10/2026'].map(date=>({...invoice,date})),
   {...invoice,rows:[{...invoice.rows[0],quantity:-1}]},
   {...invoice,rows:[{...invoice.rows[0],quantity:'3'}]},
   {...invoice,rows:[{...invoice.rows[0],reception:{kind:'approved',text:null,quantity:null}}]},
   {...invoice,quantityEvidence:{rows:[{sourceRow:1,sourcePage:1,baseline:{start:{x:-0.1,y:0.5},end:{x:0.8,y:0.5}}}],cells:[]}}
  ])expect(()=>read(value)).toThrow();
  expect(read({...invoice,date:'2024-02-29'}).date).toBe('2024-02-29');
 });
 it('never issues a second paid request or unconstrained fallback on provider rejection',async()=>{
  let requests=0;
  const client=new Anthropic({apiKey:'synthetic-key',maxRetries:0,timeout:300000,fetch:async(_url,init)=>{requests++;expect(JSON.parse(String(init?.body)).output_config.format).toEqual(invoiceOutputFormat());return Response.json({type:'error',error:{type:'invalid_request_error',message:'The compiled grammar is too large.'}},{status:400});}});
  await expect(client.messages.create({model:'synthetic',...invoiceRequestOptions(1),messages:[{role:'user',content:invoiceExtractionInstructions(1)}]})).rejects.toBeInstanceOf(Anthropic.APIError);
  expect(requests).toBe(1);
 });
});
