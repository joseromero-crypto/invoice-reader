import {describe,it,expect} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {extractionFailure} from '../server/extraction-failure';
describe('private extraction diagnostics',()=>{
 it('keeps API status without leaking provider bodies, messages or headers',()=>{
 const error=new Anthropic.APIError(401,{message:'private invoice and secret'},'private message',new Headers({'request-id':'private-header'}));
 const result=extractionFailure(error,true,'anthropic_request');
 expect(result.status).toBe('uncertain');expect(result.error).toContain('HTTP 401');expect(result.error).toContain('anthropic_request');expect(result.error).not.toContain('private');expect(result.error).not.toContain('secret');
 });
 it('keeps interrupted calls uncertain and pre-request failures failed',()=>{
 expect(extractionFailure(new Error('secret'),true,'anthropic_request').status).toBe('uncertain');
 expect(extractionFailure(new Error('secret'),false,'image_validation').status).toBe('failed');
 expect(extractionFailure(new Error('secret'),true,'structured_output').error).toContain('structured_output');
 });
});

it('classifies known request validation failures without saving provider text or arbitrary headers',()=>{
 const cases=[['Schema is too complex for compilation. private invoice SECRET','schema_complexity'],['Too many union types; private source','schema_complexity'],['output_config.format.schema: unsupported keyword with private input','output_schema_invalid'],['max_tokens must be less than maximum; secret','max_tokens_invalid'],['image dimensions are too large: secret','image_request_invalid'],['model is not supported: private-model','model_request_invalid'],['unrecognized private invoice SECRET','invalid_request_unclassified']];
 for(const [message,category]of cases){
  const error=new Anthropic.APIError(400,{error:{type:'invalid_request_error',message}},message,new Headers({'request-id':'req_SyntheticTest123','authorization':'SECRET'}));
  const result=extractionFailure(error,true,'anthropic_request');expect(result.status).toBe('uncertain');expect(result.error).toContain(`Validation: ${category}.`);expect(result.error).toContain('Provider request: req_SyntheticTest123.');expect(result.error).not.toContain('SECRET');expect(result.error).not.toContain('private');expect(result.error).not.toContain(message);
 }
});
it('does not copy message/header text, classify non-provider errors or rewrite failed calls as safe retries',()=>{
 for(const id of ['secret-header','req_bad\nvalue','req_tiny']){
  const result=extractionFailure(new Anthropic.APIError(400,{error:{message:'PRIVATE invoice'}},'PRIVATE',new Headers({'request-id':id.replace('\n',' ')})),true,'anthropic_request');expect(result.error).not.toContain('Provider request:');expect(result.error).not.toContain('PRIVATE');
 }
 const unknown=extractionFailure(new Error('Schema is too complex PRIVATE'),true,'anthropic_request');expect(unknown.error).not.toContain('Validation:');expect(unknown.status).toBe('uncertain');
 const otherStage=extractionFailure(new Anthropic.APIError(400,{message:'Schema is too complex'},'secret',undefined),true,'persist_result');expect(otherStage.error).not.toContain('Validation:');
});
it('handles a real SDK rejection shape once without automatic requests and retains only safe diagnostics',async()=>{
 let requests=0;
 const client=new Anthropic({apiKey:'synthetic-key',maxRetries:0,fetch:async()=>{requests++;return Response.json({type:'error',error:{type:'invalid_request_error',message:'Schema is too complex for compilation. PRIVATE SOURCE'}},{status:400,headers:{'request-id':'req_SyntheticSDK123'}});}});
 try{await client.messages.create({model:'synthetic',max_tokens:1,messages:[{role:'user',content:'synthetic'}]});throw Error('Expected API rejection');}catch(error){
  expect(error).toBeInstanceOf(Anthropic.APIError);const result=extractionFailure(error,true,'anthropic_request');expect(result.error).toContain('schema_complexity');expect(result.error).toContain('req_SyntheticSDK123');expect(result.error).not.toContain('PRIVATE SOURCE');expect(result.status).toBe('uncertain');
 }
 expect(requests).toBe(1);
});
