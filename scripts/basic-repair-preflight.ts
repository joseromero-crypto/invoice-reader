// FREE ONLY. No messages.create, database client, operational writes or fresh allowance.
// node --env-file=.env.local --import tsx scripts/basic-repair-preflight.ts
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {prepareColumnsInvoicePage,invoiceImageSizes} from '../server/invoice-image';
import {columnsV3InvoiceRequest} from '../server/invoice-basic-columns-v3';
import {invoiceSpendPreflight,priorDocumentSpend,documentEstimatedCost,type DocumentSpend} from '../server/invoice-spend';
assert.equal(process.argv.length,2,'This script performs free preflights only; no send/retry option');
const parent='private/testing/basic-sonnet-20261030',manifestPath='private/testing/clear-photos-20261028/manifest.json';
const json=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const write=(p:string,v:unknown)=>fs.writeFileSync(p,JSON.stringify(v,null,2),{flag:'wx',mode:0o600});
const manifest=json(manifestPath),campaign=json(`${parent}/campaign.json`);
assert.equal(sha(fs.readFileSync(manifestPath)),campaign.manifestSha256);
// Only grouping, paths, hashes and order are read from manifest. No expected answers.
const invoices=manifest.groups.flatMap((g:any)=>g.actualUploadOrder.map((u:any)=>({invoice:u.invoice,photos:u.orderedPhotos.map((name:string)=>{const p=g.photos.find((p:any)=>p.filename===name);assert(p);return {path:p.path,sha256:p.sha256};})}))).sort((a:any,b:any)=>a.invoice-b.invoice);
assert.equal(invoices.length,13);assert.equal(invoices.reduce((n:number,i:any)=>n+i.photos.length,0),24);
function prior(id:number):DocumentSpend{
 let dir=`${parent}/${String(id).padStart(2,'0')}`;
 const retry=path.resolve(`private/testing/basic-sonnet-repair-20261030/${String(id).padStart(2,'0')}-attempt-2`);
 if(fs.existsSync(`${retry}/dispatched.json`))dir=retry;
 assert(fs.existsSync(`${dir}/started.json`),'Missing original attempt');
 if(!fs.existsSync(`${dir}/dispatched.json`)){assert(!fs.existsSync(`${dir}/response.json`));return priorDocumentSpend({documentSpend:{policy:'invoice-spend-v2',calls:[]}},1);}
 const file=fs.existsSync(`${dir}/spend-final.json`)?`${dir}/spend-final.json`:`${dir}/spend-reserved.json`;
 assert(fs.existsSync(file),'Unknown prior dispatch must be investigated');return priorDocumentSpend({documentSpend:json(file)},dir===retry?2:1);
}
const priors=new Map<number,DocumentSpend>(invoices.map((i:any)=>[i.invoice,prior(i.invoice)]));
const accounted=[...priors.values()].reduce((n,s)=>n+documentEstimatedCost(s),0);assert(accounted<=1.287);
const root=path.resolve(`private/testing/basic-sonnet-repair-20261030/preflight-${Date.now()}`);fs.mkdirSync(root,{mode:0o700});
const client=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:0,timeout:180000});
const model=process.env.ANTHROPIC_MODEL;assert(model&&/^claude-sonnet-5-5(?:-\d{8})?$/.test(model));
write(`${root}/account-model.json`,await client.models.retrieve(model));
const files=['shared/basic-reading.ts','shared/printed-reading.ts','shared/domain.ts','shared/quantity-review.ts','server/invoice-basic.ts','server/invoice-basic-tables.ts','server/invoice-basic-columns.ts','server/invoice-basic-columns-v3.ts','server/invoice-output.ts','server/invoice-spend.ts','server/invoice-image.ts','server/match-extraction.ts','server/extract.ts','scripts/basic-repair-preflight.ts'];
write(`${root}/source-checkpoint.json`,Object.fromEntries(files.map(p=>[p,{sha256:sha(fs.readFileSync(p)),content:fs.readFileSync(p,'utf8')}])));
const results=[];
for(const invoice of invoices){
 const out=`${root}/${String(invoice.invoice).padStart(2,'0')}`;fs.mkdirSync(out,{mode:0o700});
 const images:Anthropic.ImageBlockParam[]=[],plans=[];
 for(const [i,photo] of invoice.photos.entries()){const original=fs.readFileSync(photo.path);assert.equal(sha(original),photo.sha256);const prepared=await prepareColumnsInvoicePage(original,model,i+1);images.push(...prepared.images);plans.push(prepared.diagnosis);}
 const sizes=invoiceImageSizes(images),request=columnsV3InvoiceRequest(model,images,sizes,invoice.photos.length),spend=priors.get(invoice.invoice)!;
 write(`${out}/originals.json`,invoice.photos);write(`${out}/view-metadata.json`,sizes);write(`${out}/image-plan.json`,plans);write(`${out}/prior-spend.json`,spend);write(`${out}/request-before-admission.json`,request);
 for(const [i,image] of images.entries())if(image.source.type==='base64')fs.writeFileSync(`${out}/view-${i+1}.jpg`,Buffer.from(image.source.data,'base64'),{flag:'wx',mode:0o600});
 const old=campaign.invoices.find((i:any)=>i.invoice===invoice.invoice);assert.deepEqual(old.photos,invoice.photos);
 const result:any={invoice:invoice.invoice,photos:invoice.photos.length,views:images.length,previousEstimatedUSD:documentEstimatedCost(spend),remainingUSD:.099-documentEstimatedCost(spend),prospectiveAttempt:spend.calls.some(c=>c.attempt===2)?null:2,billingVerified:false,paidCalls:0};
 // Capture exact free count even when admission refuses the proposed request.
 const counting={messages:{countTokens:async(args:any)=>{const counted=await client.messages.countTokens(args);write(`${out}/count.json`,counted);result.inputTokens=counted.input_tokens;return counted;}}} as unknown as Anthropic;
 try{if(result.prospectiveAttempt===null)throw Error('Two document attempts already used; manual handling required');const reservation=await invoiceSpendPreflight(counting,request,spend,invoice.photos.length);result.status='admitted';result.reservation=reservation;write(`${out}/reservation.json`,reservation);}catch(e){result.status='refused';result.reason=e instanceof Error?e.message:String(e);}
 write(`${out}/request-after-admission.json`,request);write(`${out}/result.json`,result);results.push(result);console.log(JSON.stringify(result));
}
write(`${root}/summary.json`,{at:new Date().toISOString(),generationCalls:0,priorCampaignEstimatedUSD:accounted,totalLimitUSD:1.287,documentLimitUSD:.099,manifestSha256:sha(fs.readFileSync(manifestPath)),results,limits:'Free count compatibility and admission only; not new OCR/handwriting/coverage accuracy or generation-schema acceptance. No expected answers entered prompts.'});
console.log(root);
