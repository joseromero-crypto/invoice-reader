import Anthropic from '@anthropic-ai/sdk';
export type ExtractionStage='image_validation'|'anthropic_request'|'structured_output'|'catalog_matching'|'persist_result';
export function extractionFailure(error:unknown,paidStarted:boolean,stage:ExtractionStage){
 const status=paidStarted?'uncertain' as const:'failed' as const;
 // SDK error messages/headers/bodies can contain private data. Persist only a numeric HTTP status and our own stage.
 const http=error instanceof Anthropic.APIError&&Number.isInteger(error.status)&&error.status!>=400&&error.status!<=599?` HTTP ${error.status}.`:'';
 return {status,error:`${paidStarted?'Extraction/result uncertain. Inspect before retrying.':'Image validation or extraction setup failed.'} Stage: ${stage}.${http}`};
}
