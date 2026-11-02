// Explicit LOCAL attempt 2 only; original charges and unknown reservations persist.
// node --env-file=.env.local --import tsx scripts/basic-repair-check.ts INVOICE PREFLIGHT_DIRECTORY
// A subsequent document additionally requires a written original-photo inspection of the previous result.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {columnsV3InvoiceRequest} from '../server/invoice-basic-columns-v3';
import {prepareColumnsInvoicePage,invoiceImageSizes} from '../server/invoice-image';
import {readInvoiceOutput} from '../server/invoice-output';
import {buildInvoiceRows} from '../server/match-extraction';
import {documentEstimatedCost,invoiceSpendPreflight,priorDocumentSpend,reserveDocumentCall,reconcileDocumentCall,type DocumentSpend} from '../server/invoice-spend';
import {loadPrivate} from './private-fixture';
const parent='private/testing/basic-sonnet-20261030',repair=path.resolve('private/testing/basic-sonnet-repair-20261030');
const json=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const write=(p:string,v:unknown)=>fs.writeFileSync(p,JSON.stringify(v,null,2),{flag:'wx',mode:0o600});
const id=Number(process.argv[2]),preflight=path.resolve(process.argv[3]??'');
assert.equal(process.argv.length,4);assert([3,5,8,9,12].includes(id),'Only changed quantity-shift and previously refused documents are eligible');
assert(preflight.startsWith(repair+'/preflight-'));
const freeze=json(`${preflight}/source-checkpoint.json`);
for(const [p,checkpoint] of Object.entries(freeze) as Array<[string,{sha256:string}]>)assert.equal(sha(fs.readFileSync(p)),checkpoint.sha256,`Frozen candidate changed: ${p}`);
const predecessor=new Map([[5,3],[8,5],[9,8],[12,9]]).get(id);
if(predecessor){const audit=json(`${repair}/${String(predecessor).padStart(2,'0')}-attempt-2/inspection.json`);assert(audit.inspectedOriginals&&audit.allowNextCandidateCheck&&audit.failureInvestigated!==false,'Inspect previous changed-candidate result before any next dispatch');}
function ledger(dir:string):DocumentSpend{
 if(!fs.existsSync(`${dir}/dispatched.json`)){assert(!fs.existsSync(`${dir}/response.json`));return priorDocumentSpend({documentSpend:{policy:'invoice-spend-v2',calls:[]}},1);}
 const file=fs.existsSync(`${dir}/spend-final.json`)?`${dir}/spend-final.json`:`${dir}/spend-reserved.json`;assert(fs.existsSync(file),'Unaccounted prior call');return priorDocumentSpend({documentSpend:json(file)},dir.startsWith(repair)?2:1);
}
// One shared dispatch lock and immutable attempt directory. A crash leaves the
// lock/reservation for investigation, never an automatic retry or zero cost.
const lock=`${parent}/dispatch.lock`;fs.mkdirSync(lock);
let dispatched=false,spend:DocumentSpend|undefined;
const out=`${repair}/${String(id).padStart(2,'0')}-attempt-2`;let made=false;
try{
 assert(!fs.existsSync(out),'Attempt 2 already exists; no substitute jobs or retry directories');fs.mkdirSync(out,{mode:0o700});made=true;
 const original=`${parent}/${String(id).padStart(2,'0')}`;assert(fs.existsSync(`${original}/started.json`));
 spend=ledger(original);const priorCost=documentEstimatedCost(spend),campaign=json(`${parent}/campaign.json`),invoice=campaign.invoices.find((i:any)=>i.invoice===id);assert(invoice);
 const client=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:0,timeout:300000}),model=process.env.ANTHROPIC_MODEL!;
 write(`${out}/account-model.json`,await client.models.retrieve(model));
 const images:Anthropic.ImageBlockParam[]=[],plans=[];
 for(const [i,photo] of invoice.photos.entries()){const buffer=fs.readFileSync(photo.path);assert.equal(sha(buffer),photo.sha256);const p=await prepareColumnsInvoicePage(buffer,model,i+1);images.push(...p.images);plans.push(p.diagnosis);}
 const sizes=invoiceImageSizes(images),request=columnsV3InvoiceRequest(model,images,sizes,invoice.photos.length),started=Date.now();
 write(`${out}/started.json`,{id,attempt:2,priorAttempt:original,priorCost,startedAt:new Date().toISOString(),frozenPreflight:preflight,billingVerified:false});write(`${out}/originals.json`,invoice.photos);write(`${out}/view-metadata.json`,sizes);write(`${out}/image-plan.json`,plans);write(`${out}/source-checkpoint.json`,freeze);write(`${out}/runner-checkpoint.json`,{sha256:sha(fs.readFileSync('scripts/basic-repair-check.ts')),content:fs.readFileSync('scripts/basic-repair-check.ts','utf8')});
 for(const [i,image] of images.entries())if(image.source.type==='base64')fs.writeFileSync(`${out}/view-${i+1}.jpg`,Buffer.from(image.source.data,'base64'),{flag:'wx',mode:0o600});
 write(`${out}/request-before-admission.json`,request);
 const reservation=await invoiceSpendPreflight(client,request,spend,invoice.photos.length);
 assert.deepEqual(request,json(`${preflight}/${String(id).padStart(2,'0')}/request-after-admission.json`),'Exact frozen request/image/count reproduction required');
 // Prior campaign costs are counted once: repair ledgers already include the original call.
 let accounted=0;
 for(const inv of campaign.invoices){const retry=`${repair}/${String(inv.invoice).padStart(2,'0')}-attempt-2`;accounted+=documentEstimatedCost(fs.existsSync(`${retry}/dispatched.json`)?ledger(retry):ledger(`${parent}/${String(inv.invoice).padStart(2,'0')}`));}
 assert(accounted+reservation.reservedUSD<=1.287,'Shared campaign budget exceeded');
 spend=reserveDocumentCall(spend,2,reservation);write(`${out}/reservation.json`,reservation);write(`${out}/request.json`,request);write(`${out}/spend-reserved.json`,spend);write(`${out}/dispatched.json`,{at:new Date().toISOString(),priorCampaignAccountedUSD:accounted,reservedUSD:reservation.reservedUSD});dispatched=true;
 const response=await client.messages.create(request);write(`${out}/response.json`,response);
 try{reconcileDocumentCall(spend,response.usage,response.model);}finally{write(`${out}/spend-final.json`,spend);}
 const extraction=readInvoiceOutput(response,sizes,'basic-v3');write(`${out}/extraction.json`,extraction);
 const rows=buildInvoiceRows(extraction,loadPrivate('private').products);assert(rows.every(r=>!r.confirmed&&r.actualQuantity===null&&r.confirmedQuantity===null));write(`${out}/rows.json`,rows);
 const result={invoice:id,status:'complete',attempt:2,rows:rows.length,pending:rows.filter(r=>r.flags.length).length,confirmed:0,latencyMs:Date.now()-started,usage:response.usage,estimatedThisCallUSD:documentEstimatedCost(spend)-priorCost,estimatedDocumentUSD:documentEstimatedCost(spend),billingVerified:false};write(`${out}/result.json`,result);console.log(JSON.stringify(result));
}catch(e){if(made)write(`${out}/failure.json`,{id,dispatched,error:e instanceof Error?e.message:String(e),accountedUSD:spend?documentEstimatedCost(spend):null});throw e;}
finally{fs.rmdirSync(lock);}
