// Bounded LOCAL basic campaign. No DB client or operational writes.
// node --env-file=.env.local --import tsx scripts/basic-campaign.ts init|check|INVOICE_NUMBER [--send]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {prepareBasicInvoicePage,invoiceImageSizes} from '../server/invoice-image';
import {basicInvoiceRequest} from '../server/invoice-basic';
import {readInvoiceOutput} from '../server/invoice-output';
import {buildInvoiceRows} from '../server/match-extraction';
import {invoiceSpendPreflight,priorDocumentSpend,reserveDocumentCall,reconcileDocumentCall,documentEstimatedCost} from '../server/invoice-spend';
import {loadPrivate} from './private-fixture';
const root=path.resolve('private/testing/basic-sonnet-20261030'),sourceRoot='private/testing/clear-photos-20261028';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const json=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p:string,v:unknown)=>fs.writeFileSync(p,JSON.stringify(v,null,2),{flag:'wx',mode:0o600});
const manifest=json(`${sourceRoot}/manifest.json`);
const invoices=manifest.groups.flatMap((g:any)=>g.actualUploadOrder.map((u:any)=>({invoice:u.invoice,photos:u.orderedPhotos.map((name:string)=>{const p=g.photos.find((p:any)=>p.filename===name);assert(p);return {path:p.path,sha256:p.sha256};})}))).sort((a:any,b:any)=>a.invoice-b.invoice);
assert.equal(invoices.length,13);assert.equal(invoices.reduce((n:number,i:any)=>n+i.photos.length,0),24);
const command=process.argv[2],send=process.argv[3]==='--send';
if(command==='init'){
 fs.mkdirSync(root,{mode:0o700});fs.copyFileSync('/private/tmp/basic-sonnet-start.json',`${root}/preservation-before.json`,fs.constants.COPYFILE_EXCL);
 write(`${root}/campaign.json`,{createdAt:new Date().toISOString(),purpose:'Local basic Sonnet development, no physical receiving confirmations or DB writes',allowedDocuments:13,totalLimitUSD:1.287,documentLimitUSD:.099,defaultCallsPerDocument:1,SDKRetries:0,manifestSha256:sha(fs.readFileSync(`${sourceRoot}/manifest.json`)),invoices,initialSelection:[1,13],separation:'Evaluation expectations and catalogs never enter prompts. Catalog matching is local only after parsing.'});console.log(root);process.exit(0);
}
assert(fs.existsSync(`${root}/campaign.json`));assert.equal(json(`${root}/campaign.json`).manifestSha256,sha(fs.readFileSync(`${sourceRoot}/manifest.json`)));
const client=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:0,timeout:300000});
const model=process.env.ANTHROPIC_MODEL;assert(model&&/^claude-sonnet-5-5(?:-\d{8})?$/.test(model));
if(command==='check'){
 const availability=await client.models.retrieve(model);write(`${root}/account-model.json`,availability);console.log(JSON.stringify(availability));process.exit(0);
}
assert(fs.existsSync(`${root}/account-model.json`),'Free account availability check required first');
const id=Number(command),invoice=invoices.find((i:any)=>i.invoice===id);assert(invoice,'Unknown invoice');
// One immutable attempt directory per actual invoice: restarting cannot dispatch twice.
const out=`${root}/${send?String(id).padStart(2,'0'):'preflight-'+String(id).padStart(2,'0')+'-'+Date.now()}`;fs.mkdirSync(out,{mode:0o700});
const started=Date.now(),images:Anthropic.ImageBlockParam[]=[];
write(`${out}/started.json`,{id,startedAt:new Date().toISOString(),send});
for(const [i,p] of invoice.photos.entries()){
 const original=fs.readFileSync(p.path);assert.equal(sha(original),p.sha256);images.push(...await prepareBasicInvoicePage(original,model,i+1,invoice.photos.length<3));
}
const sizes=invoiceImageSizes(images),request=basicInvoiceRequest(model,images,sizes,invoice.photos.length);
write(`${out}/originals.json`,invoice.photos);write(`${out}/view-metadata.json`,sizes);
for(const [i,image] of images.entries())if(image.source.type==='base64')fs.writeFileSync(`${out}/view-${i+1}.jpg`,Buffer.from(image.source.data,'base64'),{flag:'wx',mode:0o600});
let spend=priorDocumentSpend(null,0),dispatched=false;
try{
 const reservation=await invoiceSpendPreflight(client,request,spend,invoice.photos.length);
 write(`${out}/request.json`,request);write(`${out}/reservation.json`,reservation);
 write(`${out}/source-checkpoint.json`,Object.fromEntries(['shared/basic-reading.ts','shared/domain.ts','shared/quantity-review.ts','server/invoice-basic.ts','server/invoice-basic-tables.ts','server/invoice-output.ts','server/invoice-spend.ts','server/invoice-image.ts','server/match-extraction.ts','server/extract.ts','scripts/basic-campaign.ts'].map(p=>[p,{sha256:sha(fs.readFileSync(p)),content:fs.readFileSync(p,'utf8')}])));
 if(!send){write(`${out}/result.json`,{status:'free preflight only',reservation,views:images.length,latencyMs:Date.now()-started});console.log(JSON.stringify({id,status:'free preflight',views:images.length,...reservation}));process.exit(0);}
 // A persistent lock serializes admission and generation. A crashed process leaves
 // the lock/reservation in place, requiring investigation rather than an implicit retry.
 const lock=`${root}/dispatch.lock`;fs.mkdirSync(lock);
 try{
  const prior=fs.readdirSync(root).filter(n=>/^\d\d$/.test(n)&&n!==String(id).padStart(2,'0')).reduce((n,d)=>{
   const dir=`${root}/${d}`;if(!fs.existsSync(`${dir}/dispatched.json`))return n;
   return n+(fs.existsSync(`${dir}/spend-final.json`)?documentEstimatedCost(json(`${dir}/spend-final.json`)):json(`${dir}/reservation.json`).reservedUSD);
  },0);
  assert(prior+reservation.reservedUSD<=1.287,'Campaign reservation exceeds limit');
  spend=reserveDocumentCall(spend,1,reservation);write(`${out}/spend-reserved.json`,spend);
  write(`${out}/dispatched.json`,{at:new Date().toISOString(),priorCampaignAccountedUSD:prior,reservedUSD:reservation.reservedUSD});dispatched=true;
  const response=await client.messages.create(request);write(`${out}/response.json`,response);
  try{reconcileDocumentCall(spend,response.usage,response.model);}finally{write(`${out}/spend-final.json`,spend);}
  const extraction=readInvoiceOutput(response,sizes,'basic-v1');write(`${out}/extraction.json`,extraction);
  const products=loadPrivate(process.env.PRIVATE_FIXTURE_ROOT??'private').products;
  const rows=buildInvoiceRows(extraction,products);assert(rows.every(r=>!r.confirmed&&r.actualQuantity===null&&r.confirmedQuantity===null));write(`${out}/rows.json`,rows);
  const result={id,status:'complete',photos:invoice.photos.length,views:images.length,rows:rows.length,pending:rows.filter(r=>r.flags.length).length,confirmed:0,latencyMs:Date.now()-started,usage:response.usage,estimatedUSD:documentEstimatedCost(spend),billingVerified:false};write(`${out}/result.json`,result);console.log(JSON.stringify(result));
 }finally{fs.rmdirSync(lock);}
}catch(e){
 if(!fs.existsSync(`${out}/request.json`))write(`${out}/refused-request.json`,request);
 write(`${out}/failure.json`,{id,dispatched,error:e instanceof Error?e.message:String(e),latencyMs:Date.now()-started,accountedUSD:dispatched?documentEstimatedCost(spend):0,billingVerified:false});console.error(e instanceof Error?e.message:String(e));process.exitCode=1;
}
