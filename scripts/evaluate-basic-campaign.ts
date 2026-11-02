// Evaluation only. Never imported by request construction or paid extraction.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {needsQuantityInput,isQuantityReviewFlag} from '../shared/quantity-review';
import {exportCsv,type Document} from '../shared/domain';
const root='private/testing/basic-sonnet-20261030',source='private/testing/clear-photos-20261028';
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const adjudications=read(`${root}/evaluation-source-adjudications.json`);
const expected=read(`${source}/row-review.json`),vectors=read(`${source}/independent-photo-quantities.json`).vectors;
const campaigns=read(`${root}/campaign.json`).invoices;
const conflicts:Record<number,number[]>={1:[5,8,13,18],3:[13],4:[3],5:[3,26],7:Array.from({length:23},(_,i)=>i+1),9:[1,8,11]};
const report:any[]=[];let input=0,output=0,thinking=0,cost=0;
for(const invoice of campaigns){
 const id=invoice.invoice,dir=`${root}/${String(id).padStart(2,'0')}`;
 if(!fs.existsSync(`${dir}/started.json`))continue;
 const failure=fs.existsSync(`${dir}/failure.json`)?read(`${dir}/failure.json`):null;
 const result=fs.existsSync(`${dir}/result.json`)?read(`${dir}/result.json`):null;
 const response=fs.existsSync(`${dir}/response.json`)?read(`${dir}/response.json`):null;
 const reserved=fs.existsSync(`${dir}/reservation.json`)?read(`${dir}/reservation.json`):null;
 const record:any={invoice:id,status:result?.status??(failure?.dispatched?'rejected paid response':'refused before paid dispatch'),photos:invoice.photos.length,views:read(`${dir}/view-metadata.json`).length,latencyMs:result?.latencyMs??failure?.latencyMs,error:failure?.error??null,reservedUSD:reserved?.reservedUSD??0,estimatedUSD:result?.estimatedUSD??failure?.accountedUSD??0,billingVerified:false,acceptedRows:0};
 cost+=record.estimatedUSD;
 if(response){record.usage=response.usage;input+=response.usage.input_tokens;output+=response.usage.output_tokens;thinking+=response.usage.output_tokens_details?.thinking_tokens??0;record.stopReason=response.stop_reason;}
 record.requestSystemSha256=createHash('sha256').update(read(`${dir}/${fs.existsSync(`${dir}/request.json`)?'request.json':'refused-request.json'}`).system).digest('hex');
 if(result){
  const basic=read(`${dir}/extraction.json`).basicReading,rows=read(`${dir}/rows.json`),prior=expected.filter((r:any)=>r.invoice===id);
  record.acceptedRows=rows.length;record.expectedRows=vectors[String(id)].length;record.fullRowCount=rows.length===record.expectedRows;
  record.exactQuantityRows=basic.rows.filter((r:any,i:number)=>r.quantity===vectors[String(id)][i]).length;
  record.quantitiesWrong=basic.rows.filter((r:any,i:number)=>r.quantity!==vectors[String(id)][i]).map((r:any)=>({row:r.sourceRow,read:r.quantity,photo:vectors[String(id)][r.sourceRow-1]}));
  record.keyComparisons=basic.rows.flatMap((r:any,i:number)=>{let key=prior[i]?.supplierKey;key=adjudications.keyCorrections[String(id)]?.[String(r.sourceRow)]??key;return key===null||key===undefined?[]:[{row:r.sourceRow,read:r.supplierSku,photoReviewedKey:key,exact:r.supplierSku===key}];});
  record.barcodeComparisons=basic.rows.flatMap((r:any,i:number)=>prior[i]?.barcode?[{row:r.sourceRow,exact:r.barcode===prior[i].barcode,read:r.barcode,reviewed:prior[i].barcode}]:[]);
  record.descriptionDifferences=basic.rows.flatMap((r:any,i:number)=>r.description===prior[i]?.description?[]:[{row:r.sourceRow,read:r.description,historical:prior[i]?.description,caution:'difference requires original-photo adjudication; historical model text is not ground truth'}]);
  record.units=basic.rows.map((r:any)=>({row:r.sourceRow,unit:r.unit}));record.coverage=basic.coverage;
  record.main=rows.filter((r:any)=>!r.flags.length).length;record.pending=rows.length-record.main;record.automaticConfirmed=rows.filter((r:any)=>r.confirmed).length;
  record.manualCountInputs=rows.filter(needsQuantityInput).map((r:any)=>r.sourceRow);record.identityInputs=rows.filter((r:any)=>r.flags.some((f:string)=>!isQuantityReviewFlag(f))).map((r:any)=>r.sourceRow);
  record.knownConflictReview=(conflicts[id]??[]).map(row=>({row,observation:basic.rows[row-1]?.handwriting,individualCountRequired:rows[row-1]?needsQuantityInput(rows[row-1]):false}));
  record.checkReadingDifferences=basic.rows.filter((r:any)=>!(conflicts[id]??[]).includes(r.sourceRow)&&r.handwriting.kind!=='check_like').map((r:any)=>({row:r.sourceRow,observation:r.handwriting,expected:'visible check from independent review; no approval implied'}));
  record.sourceDoubts=basic.rows.filter((r:any)=>r.fieldUncertainties.length).map((r:any)=>({row:r.sourceRow,fields:r.fieldUncertainties}));
  const doc:Document={id:'local-evaluation',supplier:basic.supplier??'',reference:basic.reference??'',image:null,pages:invoice.photos.length,expectedPages:null,warnings:[],printedTotal:null,rows};
  try{exportCsv([doc],true,true);record.unsupportedExport=true;}catch{record.unsupportedExport=false;}
 }
 report.push(record);
}
const summary={documentCount:report.length,dispatched:report.filter(r=>r.usage).length,complete:report.filter(r=>r.status==='complete').length,refused:report.filter(r=>r.status==='refused before paid dispatch').length,rejected:report.filter(r=>r.status==='rejected paid response').length,inputTokens:input,outputTokens:output,thinkingTokensIncludedInOutput:thinking,estimatedDevelopmentUSD:cost,billingVerified:false,campaignLimitUSD:1.287,perDocumentLimitUSD:.099,allWithinDocumentLimit:report.every(r=>r.estimatedUSD<=.099),acceptedRows:report.reduce((n,r)=>n+r.acceptedRows,0),exactQuantityRows:report.reduce((n,r)=>n+(r.exactQuantityRows??0),0),automaticConfirmations:report.reduce((n,r)=>n+(r.automaticConfirmed??0),0),manualCountInputs:report.reduce((n,r)=>n+(r.manualCountInputs?.length??0),0),identityInputs:report.reduce((n,r)=>n+(r.identityInputs?.length??0),0),pendingRows:report.reduce((n,r)=>n+(r.pending??0),0),measuredReceiverSeconds:null,documents:report};
const out=`${root}/evaluation-${Date.now()}.json`;fs.writeFileSync(out,JSON.stringify(summary,null,2),{flag:'wx'});console.log(JSON.stringify({...summary,documents:report.map(r=>({invoice:r.invoice,status:r.status,rows:r.acceptedRows,exactQuantity:r.exactQuantityRows,main:r.main,pending:r.pending,manualCounts:r.manualCountInputs?.length,identityInputs:r.identityInputs?.length,missingSpecificReview:r.knownConflictReview?.filter((c:any)=>!c.individualCountRequired).map((c:any)=>c.row),estimatedUSD:r.estimatedUSD})),artifact:out}));
