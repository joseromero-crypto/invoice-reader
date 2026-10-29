import {describe,it,expect} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {invoiceRequestOptions,readInvoiceOutput} from '../server/invoice-output';
const invoice={supplier:'Synthetic supplier',reference:'00017',date:'2026-10-26',currency:'MXN',printedPage:1,printedPageCount:1,printedTotal:null,warnings:[],quantityEvidence:{rows:[],cells:[]},annotationEvidence:{rows:[{sourceRow:1,sourcePage:1,inspection:'complete',baseline:null}],marks:[]},rows:[{sourcePage:1,sourceRow:1,supplierSku:'0012',barcode:null,description:'Synthetic product',quantity:3,unit:'pieza',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:'0012 Synthetic product 3',flags:[]}]};
const content=(value:unknown)=>[{type:'text' as const,text:JSON.stringify(value),citations:null}];
describe('invoice structured output protocol',()=>{
 it('serializes a supported JSON schema through the real SDK and reads text output',async()=>{
 let sent:any;
 const client=new Anthropic({apiKey:'synthetic-test-key',maxRetries:0,timeout:300000,fetch:async(_url,init)=>{sent=JSON.parse(String(init?.body));return Response.json({id:'synthetic',type:'message',role:'assistant',model:'claude-sonnet-5-5',content:content(invoice),stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:20}});}});
 const response=await client.messages.create({model:'claude-sonnet-5-5',...invoiceRequestOptions(5),messages:[{role:'user',content:'Synthetic invoice'}]});
 expect(sent.max_tokens).toBe(32000);expect(sent.output_config.format.schema.required).toContain('annotationEvidence');expect(sent.output_config.format.schema.required).toContain('quantityEvidence');expect(sent.tools).toBeUndefined();expect(sent.tool_choice).toBeUndefined();expect(sent.output_config.format.type).toBe('json_schema');expect(sent.output_config.format.schema.additionalProperties).toBe(false);
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
