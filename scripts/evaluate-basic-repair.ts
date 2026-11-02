// EVALUATION ONLY. Never imported by extraction, prompts, preflight or dispatch.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildInvoiceRows} from '../server/match-extraction';
import {documentEstimatedCost} from '../server/invoice-spend';
import {needsQuantityInput,isQuantityReviewFlag} from '../shared/quantity-review';
import {exportCsv,type Document} from '../shared/domain';
import {loadPrivate} from './private-fixture';
const root='private/testing/basic-sonnet-repair-20261030',parent='private/testing/basic-sonnet-20261030',source='private/testing/clear-photos-20261028';
const json=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const exists=(p:string)=>fs.existsSync(p),campaign=json(`${parent}/campaign.json`),products=loadPrivate('private').products;
const vectors=json(`${source}/independent-photo-quantities.json`).vectors;
const correction=json(`${root}/03-attempt-2/original-photo-adjudication.json`);vectors['3']=correction.photoAdjudicatedVector;
const conflicts:Record<number,number[]>={1:[5,8,13,18],3:[13],4:[3],5:[3,26],7:Array.from({length:23},(_,i)=>i+1),9:[1,8,11]};
const summary:any={at:new Date().toISOString(),documentLimitUSD:.099,campaignLimitUSD:1.287,billingVerified:false,priorCampaignEstimatedUSD:0,repairEstimatedUSD:0,totalEstimatedUSD:0,repairCalls:[],documents:[],inputTokens:0,outputTokens:0,thinkingTokensIncludedInOutput:0,generationCalls:0,confirmed:0,unsupportedExports:0,manualCountInputs:0,identityInputs:0,clearProposals:0,pending:0,acceptedRows:0,printedNumericTranscriptionsCorrect:0,selectedQuantitiesCorrect:0,selectedQuantitiesWrong:0,selectedQuantitiesUnresolved:0};
for(const invoice of campaign.invoices){
 const id=invoice.invoice,first=`${parent}/${String(id).padStart(2,'0')}`,retry=`${root}/${String(id).padStart(2,'0')}-attempt-2`;
 const firstCost=exists(`${first}/dispatched.json`)?documentEstimatedCost(json(`${first}/${exists(`${first}/spend-final.json`)?'spend-final.json':'spend-reserved.json'}`)):0;
 const cost=exists(`${retry}/dispatched.json`)?documentEstimatedCost(json(`${retry}/${exists(`${retry}/spend-final.json`)?'spend-final.json':'spend-reserved.json'}`)):firstCost;
 assert(cost<=.099);summary.priorCampaignEstimatedUSD+=firstCost;summary.repairEstimatedUSD+=cost-firstCost;summary.totalEstimatedUSD+=cost;
 for(const dir of [first,retry])if(exists(`${dir}/dispatched.json`)){
  summary.generationCalls++;const response=exists(`${dir}/response.json`)?json(`${dir}/response.json`):null;
  if(response){summary.inputTokens+=response.usage.input_tokens;summary.outputTokens+=response.usage.output_tokens;summary.thinkingTokensIncludedInOutput+=response.usage.output_tokens_details?.thinking_tokens??0;}
  if(dir===retry)summary.repairCalls.push({invoice:id,status:exists(`${dir}/extraction.json`)?'complete':'strictly rejected',estimatedUSD:cost-firstCost,usage:response?.usage??null,reportedLatencyMs:exists(`${dir}/result.json`)?json(`${dir}/result.json`).latencyMs:null,generationLatencyMs:response?Math.round(fs.statSync(`${dir}/response.json`).mtimeMs-Date.parse(json(`${dir}/dispatched.json`).at)):null,latencyScope:'reported: free count through matching, excludes image preparation/account query; generation: dispatch record to response captured',stopReason:response?.stop_reason??null,requestSystemSha256:createHash('sha256').update(json(`${dir}/request.json`).system).digest('hex'),nativeVersion:json(`${dir}/request.json`).output_config.format.schema.properties.version.enum[0]});
 }
 const selected=exists(`${retry}/extraction.json`)?retry:exists(`${first}/extraction.json`)?first:null;
 const record:any={invoice:id,photos:invoice.photos.length,estimatedDocumentUSD:cost,remainingUSD:.099-cost,attemptsUsed:exists(`${retry}/started.json`)?2:1,acceptedRead:selected?.replace(parent,'first').replace(root,'repair')??null,parsedStatus:selected?'complete':'truncated / manual handling',expectedRows:vectors[String(id)].length};
 if(selected){
  const e=json(`${selected}/extraction.json`),rows=buildInvoiceRows(e,products),basic=e.basicReading;
  record.rows=rows.length;record.readingMode=e.readingMode;record.views=json(`${selected}/view-metadata.json`).length;record.main=rows.filter(r=>!r.flags.length).length;record.pending=rows.length-record.main;record.manualCountRows=rows.filter(needsQuantityInput).map(r=>r.sourceRow);record.identityReviewRows=rows.filter(r=>r.flags.some(f=>!isQuantityReviewFlag(f))).map(r=>r.sourceRow);record.confirmed=rows.filter(r=>r.confirmed).length;
  record.selectedQuantitiesCorrect=basic.rows.filter((r:any,i:number)=>r.quantity===vectors[String(id)][i]).length;record.selectedQuantitiesWrong=basic.rows.filter((r:any,i:number)=>r.quantity!==null&&r.quantity!==vectors[String(id)][i]).length;record.selectedQuantitiesUnresolved=basic.rows.filter((r:any)=>r.quantity===null).length;
  record.printedNumericTranscriptionsCorrect=e.printedReading?e.printedReading.rows.filter((r:any,i:number)=>{const t=e.printedReading.tables.find((t:any)=>t.id===r.tableId),piece=t.quantityHeaders.findIndex((h:string)=>h==='PIEZAS');return piece>=0?Number(r.printedQuantities[piece])===vectors[String(id)][i]:r.printedQuantities.every((v:string|null)=>v!==null&&Number(v)===vectors[String(id)][i]);}).length:record.selectedQuantitiesCorrect;
  record.coverage=basic.coverage;record.knownConflictsNotIndividuallyPending=(conflicts[id]??[]).filter(row=>rows[row-1]&&!needsQuantityInput(rows[row-1]));
  record.inspection=exists(`${selected}/inspection.json`)?json(`${selected}/inspection.json`):'Earlier campaign review retained; original-photo correction to invoice3 is additive';
  const doc:Document={id:'evaluation',supplier:e.supplier??'',reference:e.reference??'',image:null,pages:invoice.photos.length,expectedPages:null,warnings:[],printedTotal:null,rows};
  try{exportCsv([doc],true,true);record.unsupportedExport=true;summary.unsupportedExports++;}catch{record.unsupportedExport=false;}
  summary.acceptedRows+=rows.length;summary.clearProposals+=record.main;summary.pending+=record.pending;summary.manualCountInputs+=record.manualCountRows.length;summary.identityInputs+=record.identityReviewRows.length;summary.confirmed+=record.confirmed;
  for(const metric of ['printedNumericTranscriptionsCorrect','selectedQuantitiesCorrect','selectedQuantitiesWrong','selectedQuantitiesUnresolved'])summary[metric]+=record[metric];
 }
 summary.documents.push(record);
}
assert(summary.totalEstimatedUSD<=1.287);assert.equal(summary.confirmed,0);assert.equal(summary.unsupportedExports,0);
summary.qualityCaveats=['Different prompt revisions; only invoice12 freshly used final prompt. Current matching/source-review audit replayed locally, no further generation.','Printed numeric transcription does not certify units, identity, mark ownership or received counts. No receiver time study.','Invoice3 old quantity vector corrected from original; initial basic quantities were right, historical model had eight shifted values.','Historical 238/238 claim is withdrawn: corrected invoice3 alone shows eight historical errors; other old vectors not reaudited in this repair.','Invoice4 retained read still has31 wrong case-vs-piece selections; invoice1 has no accepted29-row read. No useful retry fits their remaining balances.','Invoice3 retained v1 mark misses required individual review at row13. Manual handling required; no prior record is rewritten.','Invoice5 omitted separate CAJAS units on28 rows; invoice8 supplier keys wrong on9 rows; invoice9 barcode fields missing11 despite digits retained in source text.','Invoice12 both case columns preserved;14 receiving counts stay blank. One false other mark and14 unnecessary no-separate-unit doubts.'];
summary.recommendedConfiguration={mode:'basic-v2 logical source / invoice-basic-columns-v3 native transport',model:'claude-sonnet-5-5',thinking:'between_tools',effort:'low',SDKRetries:0,paidCallsPerClaim:1,documentLimitUSD:.099,imageProfile:'EXIF only, full overview<=1600 patches plus useful ink detail(s)<=4784 combined patches; no blind halves',actualOutputAllowance:'6500 initial, resized to remaining balance; conservative minima2200/3200/4200, hard ceilings16000/32000',acceptance:'supervised local candidate only; production acceptance still FAIL',targetAverageUSD:'0.05–0.08 remains unvalidated on a frozen full13 candidate'};
const out=`${root}/evaluation-${Date.now()}.json`;fs.writeFileSync(out,JSON.stringify(summary,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({artifact:out,...Object.fromEntries(Object.entries(summary).filter(([k])=>!['documents','qualityCaveats','recommendedConfiguration','repairCalls'].includes(k)))}));
