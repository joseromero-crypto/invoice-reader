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
