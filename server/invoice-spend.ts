import type Anthropic from '@anthropic-ai/sdk';

// Standard global on-demand rates, verified 2026-10-30. No cache/tools/batch/fast
// billing is enabled on this path. Unknown models fail closed, never use stale env rates.
export const DOCUMENT_BUDGET_USD=0.099;
export const MAX_DOCUMENT_ATTEMPTS=2;
// Kept as a public upper bound, no equal/non-transferable slots.
export const ATTEMPT_BUDGET_USD=DOCUMENT_BUDGET_USD;
export const SPEND_POLICY='invoice-spend-v2';
export class InvoiceBudgetError extends Error {}
export function invoicePrice(model:string,inputTokens:number){
 if(!Number.isSafeInteger(inputTokens)||inputTokens<0)throw new InvoiceBudgetError('Invalid input token count');
 if(/^claude-haiku-5-5(?:-\d{8})?$/.test(model))return inputTokens>100000?{input:0.5,output:2.5}:{input:0.1,output:0.5};
 if(/^claude-sonnet-5-5(?:-\d{8})?$/.test(model))return {input:2,output:10};
 throw new InvoiceBudgetError('Model has no verified invoice pricing');
}
export function invoiceUsageCost(model:string,usage:Pick<Anthropic.Usage,'input_tokens'|'output_tokens'|'cache_creation_input_tokens'|'cache_read_input_tokens'>){
 // Count thinking once: it is already part of output_tokens. Reject unexpected
 // billing modes instead of silently underpricing an enabled cache/tool feature.
 if(usage.cache_creation_input_tokens||usage.cache_read_input_tokens)throw new InvoiceBudgetError('Unexpected cached invoice usage');
 const price=invoicePrice(model,usage.input_tokens);
 if(!Number.isSafeInteger(usage.output_tokens)||usage.output_tokens<0)throw new InvoiceBudgetError('Invalid output token count');
 return (usage.input_tokens*price.input+usage.output_tokens*price.output)/1e6;
}
export async function invoiceSpendPreflight(client:Pick<Anthropic,'messages'>,request:Anthropic.MessageCreateParamsNonStreaming,prior:DocumentSpend={policy:SPEND_POLICY,calls:[]},pages=1){
 if(request.tools?.length||(request.service_tier&&request.service_tier!=='standard_only')||(request.speed&&request.speed!=='standard')||request.messages.length!==1||!Number.isSafeInteger(request.max_tokens)||request.max_tokens<1||request.max_tokens>32000)throw new InvoiceBudgetError('Unsupported invoice billing mode');
 // Token counting is free and includes the exact images and output grammar.
 // It is an estimate: reserve 20% + 1024 tokens and price the upper tier when
 // that allowance straddles 100K. Failure to count prevents dispatch.
 invoicePrice(request.model,0);
 const counted=await client.messages.countTokens({model:request.model,system:request.system,messages:request.messages,output_config:request.output_config,thinking:request.thinking});
 if(!Number.isSafeInteger(counted.input_tokens)||counted.input_tokens<1)throw new InvoiceBudgetError('Invalid provider input estimate');
 const reservedInputTokens=Math.ceil(counted.input_tokens*1.2)+1024;
 const price=invoicePrice(request.model,reservedInputTokens);
 const remainingUSD=DOCUMENT_BUDGET_USD-documentEstimatedCost(prior);
 if(prior.blocked||remainingUSD<=0)throw new InvoiceBudgetError('Invoice document spend blocked');
 // Only the explicitly basic contract has a smaller response. Never resize a
 // legacy complete-evidence request into an intentionally truncated purchase.
 const schema=request.output_config?.format?.schema as any;
 if(schema?.properties?.version?.const==='invoice-basic-v1'||['invoice-basic-v1','invoice-basic-tables-v1','invoice-basic-columns-v2','invoice-basic-columns-v3'].includes(schema?.properties?.version?.enum?.[0])){
  const affordable=Math.floor((remainingUSD-reservedInputTokens*price.input/1e6)*1e6/price.output)-1;
  const ceiling=pages>=3?32000:16000;
  const allowance=Math.min(request.max_tokens,ceiling,affordable);
  const usefulMinimum=pages>=3?4200:pages===2?3200:2200;
  if(allowance<usefulMinimum)throw new InvoiceBudgetError('La lectura completa no cabe en el presupuesto. Usa las fotos originales y manejo manual.');
  request.max_tokens=allowance;
 }
 const reservedUSD=(reservedInputTokens*price.input+request.max_tokens*price.output)/1e6;
 if(reservedUSD>remainingUSD)throw new InvoiceBudgetError('La lectura excede el presupuesto del documento. Confirma los datos dudosos manualmente.');
 return {policy:SPEND_POLICY,documentBudgetUSD:DOCUMENT_BUDGET_USD,remainingBudgetUSD:remainingUSD,attemptBudgetUSD:ATTEMPT_BUDGET_USD,estimatedInputTokens:counted.input_tokens,reservedInputTokens,maxOutputTokens:request.max_tokens,reservedUSD,price,pricingVerifiedAt:'2026-10-30',billingVerified:false};
}
export type SpendReservation=Awaited<ReturnType<typeof invoiceSpendPreflight>>;
export type DocumentSpend={policy:typeof SPEND_POLICY;blocked?:true;calls:Array<{attempt:number;reservation:SpendReservation;estimatedActualUSD:number|null;usage:Anthropic.Usage|null}>};
export function priorDocumentSpend(usage:unknown,attempts:number):DocumentSpend{
 if(!Number.isInteger(attempts)||attempts<0||attempts>MAX_DOCUMENT_ATTEMPTS)throw new InvoiceBudgetError('Invalid invoice attempt history');
 const prior=(usage as {documentSpend?:DocumentSpend}|null)?.documentSpend;
 if(attempts===0){if(prior&&(prior.blocked||!Array.isArray(prior.calls)||prior.calls.length))throw new InvoiceBudgetError('Invalid reset invoice spend history');return {policy:SPEND_POLICY,calls:[]};}
 if(prior?.blocked)throw new InvoiceBudgetError('Invoice document spend blocked; manual review required');
 if(!prior||!['invoice-spend-v1',SPEND_POLICY].includes(prior.policy)||!Array.isArray(prior.calls)||prior.calls.length>attempts||prior.calls.some(c=>!Number.isInteger(c.attempt)||c.attempt<1||c.attempt>attempts||!['invoice-spend-v1',SPEND_POLICY].includes(c.reservation?.policy)||!Number.isFinite(c.reservation.reservedUSD)||c.reservation.reservedUSD<0||c.reservation.reservedUSD>ATTEMPT_BUDGET_USD||(c.estimatedActualUSD!==null&&(!Number.isFinite(c.estimatedActualUSD)||c.estimatedActualUSD<0))))throw new InvoiceBudgetError('El gasto anterior no está acotado. Revisión manual requerida antes de otra lectura.');
 if(new Set(prior.calls.map(c=>c.attempt)).size!==prior.calls.length)throw new InvoiceBudgetError('Duplicate invoice spend history');
 const migrated:DocumentSpend={...structuredClone(prior),policy:SPEND_POLICY};
 if(documentEstimatedCost(migrated)>DOCUMENT_BUDGET_USD)throw new InvoiceBudgetError('Invoice document spend exceeded');
 return migrated;
}
export function reserveDocumentCall(prior:DocumentSpend,attempt:number,reservation:SpendReservation):DocumentSpend{
 if(prior.blocked)throw new InvoiceBudgetError('Invoice document spend blocked; manual review required');
 if(!Number.isInteger(attempt)||attempt<1||attempt>MAX_DOCUMENT_ATTEMPTS||prior.calls.some(c=>c.attempt>=attempt))throw new InvoiceBudgetError('Invoice call/attempt limit reached');
 // One paid extraction per claim. No classification, fallback, crop loop or
 // automatic escalation. Each call uses the remaining document allowance;
 // unknown/interrupted usage keeps its full reservation across worker restarts.
 if(!Number.isFinite(reservation.reservedUSD)||reservation.reservedUSD<0||reservation.reservedUSD>ATTEMPT_BUDGET_USD)throw new InvoiceBudgetError('Invoice attempt spend exceeded');
 const calls=[...prior.calls,{attempt,reservation,estimatedActualUSD:null,usage:null}];
 if(calls.reduce((sum,c)=>sum+(c.estimatedActualUSD??c.reservation.reservedUSD),0)>DOCUMENT_BUDGET_USD)throw new InvoiceBudgetError('Invoice document spend exceeded');
 return {policy:SPEND_POLICY,calls};
}
export function reconcileDocumentCall(spend:DocumentSpend,usage:Anthropic.Usage,model:string){
 const call=spend.calls.at(-1);if(!call||call.usage)throw new InvoiceBudgetError('Missing/duplicate invoice reservation');
 call.usage=usage;
 try{
  call.estimatedActualUSD=invoiceUsageCost(model,usage);
  if(usage.input_tokens>call.reservation.reservedInputTokens||usage.output_tokens>call.reservation.maxOutputTokens||call.estimatedActualUSD>call.reservation.reservedUSD)throw new InvoiceBudgetError('Provider usage exceeded invoice reservation; manual review required');
 }catch(error){spend.blocked=true;throw error;}
 return spend;
}
export function documentEstimatedCost(spend:DocumentSpend):number{return spend.calls.reduce((sum,c)=>sum+(c.estimatedActualUSD??c.reservation.reservedUSD),0);}
