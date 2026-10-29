import type Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {ExtractionSchema} from '../shared/domain';
// Saved results remain backward compatible; new paid reads must return the inventory.
const FreshExtractionSchema=ExtractionSchema.required({annotationEvidence:true,quantityEvidence:true});
// Structured JSON is supported by Sonnet 5.5, which rejects forced tool calls.
// The SDK transforms unsupported schema constraints; Zod still enforces them locally.
export function invoiceOutputFormat(){return zodOutputFormat(FreshExtractionSchema);}
// Dense multi-photo documents need room for both adaptive thinking and the JSON rows.
// This ceiling limits one response; it is independent of usage accounting.
export function invoiceRequestOptions(pages:number){return {max_tokens:pages>=3?32000:16000,output_config:{format:invoiceOutputFormat()}};}
// Failed output stays private in extraction_jobs; never turn partial JSON into receiving rows.
export function invoiceOutputEvidence(response:Pick<Anthropic.Message,'stop_reason'|'content'>){return {stopReason:response.stop_reason,textBlocks:response.content.filter(block=>block.type==='text').map(block=>block.text)};}
export function readInvoiceOutput(response:Pick<Anthropic.Message,'stop_reason'|'content'>){
 if(response.stop_reason!=='end_turn')throw Error('Extraction did not complete');
 const text=response.content.filter(block=>block.type==='text');
 if(text.length!==1)throw Error('Missing or ambiguous structured output');
 return FreshExtractionSchema.parse(JSON.parse(text[0].text));
}
