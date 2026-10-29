import Anthropic from '@anthropic-ai/sdk';
export type ExtractionStage='image_validation'|'anthropic_request'|'structured_output'|'catalog_matching'|'persist_result';
// Provider messages may echo private input. Classify recognized validation
// patterns into application-owned constants; never persist the message itself.
function validationCategory(error:InstanceType<typeof Anthropic.APIError>){
 if(error.status!==400)return null;
 const body=error.error as {error?:{message?:unknown};message?:unknown}|undefined;
 const message=body?.error?.message??body?.message;
 if(typeof message!=='string')return 'invalid_request_unclassified';
 if(/schema is too complex|compiled grammar.{0,60}(?:too large|size|limit)|schema.{0,60}compilation.{0,30}(?:timeout|timed out)|too many (?:optional parameters|union types)|(?:optional parameters|union types).{0,40}(?:limit|maximum|exceed)/i.test(message))return 'schema_complexity';
 if(/(?:json schema|output_config\.format|output schema|schema).{0,120}(?:unsupported|not supported|invalid|not permitted)|(?:unsupported|invalid).{0,60}(?:schema|output_config\.format)/i.test(message))return 'output_schema_invalid';
 if(/max_tokens.{0,80}(?:greater|less|maximum|minimum|range|invalid)|(?:invalid|unsupported).{0,30}max_tokens/i.test(message))return 'max_tokens_invalid';
 if(/(?:image|base64).{0,80}(?:invalid|unsupported|too large|dimensions|decode)|(?:invalid|unsupported).{0,30}(?:image|base64)/i.test(message))return 'image_request_invalid';
 if(/(?:model).{0,60}(?:invalid|not found|unsupported|not supported)|(?:invalid|unsupported).{0,30}model/i.test(message))return 'model_request_invalid';
 return 'invalid_request_unclassified';
}
export function extractionFailure(error:unknown,paidStarted:boolean,stage:ExtractionStage){
 const status=paidStarted?'uncertain' as const:'failed' as const;
 const api=error instanceof Anthropic.APIError?error:null;
 const http=api&&Number.isInteger(api.status)&&api.status!>=400&&api.status!<=599?` HTTP ${api.status}.`:'';
 const category=api&&stage==='anthropic_request'?validationCategory(api):null;
 // Only the provider's documented request-id format, never arbitrary headers.
 const requestId=api&&typeof api.requestID==='string'&&/^req_[A-Za-z0-9]{8,100}$/.test(api.requestID)?api.requestID:null;
 const detail=category?` Validation: ${category}.`:'';
 return {status,error:`${paidStarted?'Extraction/result uncertain. Inspect before retrying.':'Image validation or extraction setup failed.'} Stage: ${stage}.${http}${detail}${requestId?` Provider request: ${requestId}.`:''}`};
}
