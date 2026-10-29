import {describe,it,expect} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {invoiceRequestOptions,invoiceExtractionInstructions,invoiceOutputFormat,readInvoiceOutput} from '../server/invoice-output';
const invoice={supplier:'Synthetic supplier',reference:'00017',date:'2026-10-26',currency:'MXN',printedPage:1,printedPageCount:1,printedTotal:null,warnings:[],quantityEvidence:{rows:[],cells:[]},annotationEvidence:{rows:[{sourceRow:1,sourcePage:1,inspection:'complete',baseline:null}],marks:[]},rows:[{sourcePage:1,sourceRow:1,supplierSku:'0012',barcode:null,description:'Synthetic product',quantity:3,unit:'pieza',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:'0012 Synthetic product 3',reception:{kind:'none',text:null,quantity:null},fieldUncertainties:[],receptionMarked:false,flags:[]}]};
const content=(value:unknown)=>[{type:'text' as const,text:JSON.stringify(value),citations:null}];
describe('invoice structured output protocol',()=>{
 it('sends a normal Messages request with the full prompt contract and validates output locally',async()=>{
 let sent:any;
 const client=new Anthropic({apiKey:'synthetic-test-key',maxRetries:0,timeout:300000,fetch:async(_url,init)=>{sent=JSON.parse(String(init?.body));return Response.json({id:'synthetic',type:'message',role:'assistant',model:'claude-sonnet-5-5',content:content(invoice),stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:20}});}});
 const response=await client.messages.create({model:'claude-sonnet-5-5',...invoiceRequestOptions(5),messages:[{role:'user',content:invoiceExtractionInstructions(5)}]});
 expect(sent.max_tokens).toBe(32000);expect(sent.output_config).toBeUndefined();expect(sent.output_format).toBeUndefined();expect(sent.tools).toBeUndefined();expect(sent.tool_choice).toBeUndefined();
 expect(sent.messages[0].content).toBe(invoiceExtractionInstructions(5));expect(sent.messages[0].content).toContain('annotationEvidence');expect(sent.messages[0].content).toContain('quantityEvidence');expect(sent.messages[0].content).toContain('JSON Schema');
 const result=readInvoiceOutput(response);expect(result.rows[0].supplierSku).toBe('0012');expect(result.reference).toBe('00017');expect(result.rows[0].price).toBeNull();
 });
 it('rejects refusals, truncation and malformed or invalid results',()=>{
 const {annotationEvidence,...legacy}=invoice;expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:content(legacy)})).toThrow();
 const {quantityEvidence,...noQuantities}=invoice;expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:content(noQuantities)})).toThrow();
 for(const stop_reason of ['refusal','max_tokens'] as const)expect(()=>readInvoiceOutput({stop_reason,content:content(invoice)})).toThrow();
 expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:'broken',citations:null}]})).toThrow();
 expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:content({...invoice,rows:[]})})).toThrow();
 expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:content({...invoice,date:'not-a-date'})})).toThrow();
 });
});

it('keeps the prompt contract closed, explicit and referentially valid',()=>{
 const schema=invoiceOutputFormat().schema as any;
 let unions=0,optional=0;
 const walk=(node:any)=>{
  if(node.anyOf||node.oneOf||Array.isArray(node.type))unions++;
  if(node.type==='object')expect(node.additionalProperties).toBe(false);
  for(const [key,value]of Object.entries(node.properties??{})){if(!node.required?.includes(key))optional++;walk(value);}
  if(node.$ref){expect(node.$ref).toMatch(/^#\//);const target=node.$ref.slice(2).split('/').reduce((v:any,k:string)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],schema);expect(target).toBeDefined();}
  if(node.items)walk(node.items);
  for(const key of ['anyOf','oneOf','allOf'])node[key]?.forEach(walk);
  Object.values(node.$defs??{}).forEach(walk);
 };
 walk(schema);expect(unions).toBeLessThanOrEqual(8);expect(optional).toBe(0);
 // This checks prompt/local-validation structure, not actual provider output.
 expect(schema.properties.annotationEvidence).toBeDefined();expect(schema.properties.quantityEvidence).toBeDefined();
});
it('requires explicit fresh reception observations while preserving nullable source values',()=>{
 for(const key of ['reception','fieldUncertainties','receptionMarked']){
  const row={...invoice.rows[0]} as any;delete row[key];expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:content({...invoice,rows:[row]})})).toThrow();
 }
 const unknown={...invoice,rows:[{...invoice.rows[0],supplierSku:null,barcode:null,quantity:null}]};
 const parsed=readInvoiceOutput({stop_reason:'end_turn',content:content(unknown)});expect(parsed.rows[0].quantity).toBeNull();expect(parsed.rows[0].supplierSku).toBeNull();expect(parsed.rows[0].receptionMarked).toBe(false);
});

it('avoids provider grammar rejection without an automatic second request',async()=>{
 let requests=0;
 const client=new Anthropic({apiKey:'synthetic-key',maxRetries:0,fetch:async(_url,init)=>{
  requests++;const sent=JSON.parse(String(init?.body));
  if(sent.output_config?.format)return Response.json({type:'error',error:{type:'invalid_request_error',message:'Schema is too complex for compilation.'}},{status:400});
  return Response.json({id:'synthetic',type:'message',role:'assistant',model:'synthetic',content:content(invoice),stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}});
 }});
 const response=await client.messages.create({model:'synthetic',...invoiceRequestOptions(1),messages:[{role:'user',content:invoiceExtractionInstructions(1)}]});
 expect(readInvoiceOutput(response).rows[0].quantity).toBe(3);expect(requests).toBe(1);
});
it('fails closed on well-formed JSON that omits or violates independent evidence',()=>{
 for(const value of [
  {...invoice,quantityEvidence:undefined},
  {...invoice,annotationEvidence:undefined},
  {...invoice,quantityEvidence:{rows:[{sourceRow:1,sourcePage:1,baseline:{start:{x:-0.1,y:0.5},end:{x:0.8,y:0.5}}}],cells:[]}},
  {...invoice,rows:[{...invoice.rows[0],quantity:-1}]},
  {...invoice,rows:[{...invoice.rows[0],reception:{kind:'approved',text:null,quantity:null}}]}
 ])expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:content(value)})).toThrow();
 expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:content({rows:invoice.rows})})).toThrow();
 expect(()=>readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:'```json\n'+JSON.stringify(invoice)+'\n```',citations:null}]})).toThrow();
});
