import type Anthropic from '@anthropic-ai/sdk';
import {z} from 'zod';
import {ExtractionSchema} from '../shared/domain';
// Saved results remain backward compatible; new paid reads must return the inventory.
// Fresh reads always report these observations, using kind=none, [] and false
// only when supported by inspection. Legacy domain parsing stays optional.
const FreshRowSchema=ExtractionSchema.shape.rows.element.required({reception:true,fieldUncertainties:true,receptionMarked:true});
const FreshExtractionSchema=ExtractionSchema.required({annotationEvidence:true,quantityEvidence:true}).extend({rows:FreshRowSchema.array().min(1)});
// Keep the complete contract in the prompt and validate locally. Do not send
// output_config.format: the nested evidence schema then enters the provider's
// grammar compiler, which can reject the entire request before OCR begins.
// This is the first/only request path, never a second paid fallback after a 400.
export function invoiceOutputFormat(){return {type:'json_schema' as const,schema:z.toJSONSchema(FreshExtractionSchema,{reused:'ref'})};}
export function invoiceExtractionInstructions(pages:number){return `Extract these ${pages} invoice page images in order. Return all visible supplier rows, nullable unknowns, and warnings. Return ONLY one JSON object, with no Markdown fences or explanatory text. Both independent evidence inventories and explicit per-row reception observations are mandatory. Unknown values must stay null; never omit evidence or invent a value to satisfy the schema. The application validates this complete JSON Schema before accepting any receiving rows:\n${JSON.stringify(invoiceOutputFormat().schema)}`;}
// Preserve the existing response ceilings; avoid provider-side schema compilation.
export function invoiceRequestOptions(pages:number){return {max_tokens:pages>=3?32000:16000};}
// Failed output stays private in extraction_jobs; never turn partial JSON into receiving rows.
export function invoiceOutputEvidence(response:Pick<Anthropic.Message,'stop_reason'|'content'>){return {stopReason:response.stop_reason,textBlocks:response.content.filter(block=>block.type==='text').map(block=>block.text)};}
export function readInvoiceOutput(response:Pick<Anthropic.Message,'stop_reason'|'content'>){
 if(response.stop_reason!=='end_turn')throw Error('Extraction did not complete');
 const text=response.content.filter(block=>block.type==='text');
 if(text.length!==1)throw Error('Missing or ambiguous structured output');
 return FreshExtractionSchema.parse(JSON.parse(text[0].text));
}
