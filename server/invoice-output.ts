import type Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {ExtractionSchema} from '../shared/domain';
// Structured JSON is supported by Sonnet 5.5, which rejects forced tool calls.
// The SDK transforms unsupported schema constraints; Zod still enforces them locally.
export function invoiceOutputFormat(){return zodOutputFormat(ExtractionSchema);}
export function readInvoiceOutput(response:Pick<Anthropic.Message,'stop_reason'|'content'>){
 if(response.stop_reason!=='end_turn')throw Error('Extraction did not complete');
 const text=response.content.filter(block=>block.type==='text');
 if(text.length!==1)throw Error('Missing or ambiguous structured output');
 return ExtractionSchema.parse(JSON.parse(text[0].text));
}
