import type Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {ExtractionSchema} from '../shared/domain';
import {assertInvoiceShape} from './invoice-shape';
// Saved results remain backward compatible; new paid reads must return the inventory.
// Fresh reads always report these observations, using kind=none, [] and false
// only when supported by inspection. Legacy domain parsing stays optional.
const FreshRowSchema=ExtractionSchema.shape.rows.element.required({reception:true,fieldUncertainties:true,receptionMarked:true});
const FreshExtractionSchema=ExtractionSchema.required({annotationEvidence:true,quantityEvidence:true}).extend({rows:FreshRowSchema.array().min(1)});
// Full native schemas (including zero-union/flattened variants) exceeded the
// provider grammar limit. Compile only a fixed JSON envelope. All original
// source/evidence fields are still mandatory and validated before use.
const sourceSchema=zodOutputFormat(FreshExtractionSchema).schema;
export function invoiceOutputFormat(){return {type:'json_schema' as const,schema:{type:'object',properties:{invoice:{type:'string',description:'JSON-serialized complete invoice object matching the domain schema supplied in the user message.'}},required:['invoice'],additionalProperties:false}};}
export function invoiceExtractionInstructions(pages:number){return `Extract these ${pages} invoice page images in order. Return all visible supplier rows and warnings. Both independent evidence inventories and explicit per-row reception observations are mandatory. Return ONLY the native envelope {"invoice":"<JSON text>"}. Its invoice string must contain one complete JSON object matching the domain schema below: serialize the object as JSON, then encode that JSON as the envelope's string value. Inside it use ordinary null for unknown values, exact source strings (including leading zeros), numbers for known quantities, ordinary objects for positions/baselines, and arrays for lists. Do not omit required evidence, invent placeholders, return markdown, or add envelope fields. Example envelope encoding only: {"invoice":"{\\"supplier\\":\\"Example\\",\\"reference\\":null}"}. The example is incomplete; your actual invoice object must satisfy ALL fields in this domain schema:\n${JSON.stringify(sourceSchema)}`;}
// Native formatting is part of the first/only request. Never silently switch to
// unconstrained output or make a second paid call after a schema rejection.
export function invoiceRequestOptions(pages:number){return {max_tokens:pages>=3?32000:16000,output_config:{format:invoiceOutputFormat()}};}
// Failed output stays private in extraction_jobs; never turn partial JSON into receiving rows.
export function invoiceOutputEvidence(response:Pick<Anthropic.Message,'stop_reason'|'content'>){return {stopReason:response.stop_reason,textBlocks:response.content.filter(block=>block.type==='text').map(block=>block.text)};}
export function readInvoiceOutput(response:Pick<Anthropic.Message,'stop_reason'|'content'>){
 if(response.stop_reason!=='end_turn')throw Error('Extraction did not complete');
 const text=response.content.filter(block=>block.type==='text');
 if(text.length!==1)throw Error('Missing or ambiguous structured output');
 const envelope=JSON.parse(text[0].text);
 if(envelope===null||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).length!==1||typeof envelope.invoice!=='string')throw Error('Invalid invoice envelope');
 const value=JSON.parse(envelope.invoice);
 assertInvoiceShape(sourceSchema,value);
 return FreshExtractionSchema.parse(value);
}
