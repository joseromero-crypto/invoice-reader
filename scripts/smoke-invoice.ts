// Explicit local diagnostic: one complete invoice request, no production DB writes.
// node --env-file=.env.local --import tsx scripts/smoke-invoice.ts IMAGE [IMAGE ...] OUTPUT_DIR [--between-tools|--overviews-only|--no-thinking] [--send]
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {invoiceRequest,prepareInvoicePage,invoiceImageSizes} from '../server/invoice-request';
import {invoiceOutputEvidence,readInvoiceOutput} from '../server/invoice-output';
import {extractionFailure,type ExtractionStage} from '../server/extraction-failure';
import {buildInvoiceRows} from '../server/match-extraction';
import {loadPrivate} from './private-fixture';
import {invoiceSpendPreflight,invoiceUsageCost} from '../server/invoice-spend';
import {limits} from '../server/config';
const args=process.argv.slice(2),send=args.at(-1)==='--send';
if(send)args.pop();
const noThinking=args.at(-1)==='--no-thinking';
if(noThinking)args.pop();
const overviewsOnly=args.at(-1)==='--overviews-only';
if(overviewsOnly)args.pop();
const betweenTools=args.at(-1)==='--between-tools';
if(betweenTools)args.pop();
const outputDir=args.pop(),imageFiles=args;
if(!outputDir||!imageFiles.length||imageFiles.length>limits().maxPages||[...imageFiles,outputDir].some(f=>f.startsWith('--')))throw Error('Usage: smoke-invoice.ts IMAGE [IMAGE ...] PRIVATE_OUTPUT_DIR [--between-tools] [--send]');
const out=path.resolve(outputDir),privateRoot=fs.realpathSync('private');
if(!out.startsWith(privateRoot+path.sep))throw Error('Diagnostic output must stay inside private/');
// New directory only: never overwrite prior evidence or retry a started request.
fs.mkdirSync(out,{recursive:false,mode:0o700});
if(!fs.realpathSync(out).startsWith(privateRoot+path.sep))throw Error('Output path escapes private/');
const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
const originals=imageFiles.map(file=>fs.readFileSync(file));
if(originals.some(original=>original.length>limits().maxUploadBytes))throw Error('Image too large');
const model=process.env.ANTHROPIC_MODEL;
const images:Anthropic.ImageBlockParam[]=[];
try{for(const [i,original] of originals.entries()){const prepared=await prepareInvoicePage(original,model??'claude-sonnet-5-5',i+1,originals.length<3);images.push(...(overviewsOnly?prepared.slice(0,1):prepared));}}catch(error){
 const diagnostic=extractionFailure(error,false,'image_validation');
 write('result.json',{kind:'local photo preflight; no provider request',...diagnostic,finishedAt:new Date().toISOString()});
 console.log(JSON.stringify(diagnostic));process.exit(1);
}
const request=invoiceRequest(model??'claude-sonnet-5-5',images,betweenTools?'between_tools':noThinking?'disabled':'adaptive',undefined,originals.length);
const timeout=originals.length>=3?300000:180000;
const summary={overviewsOnly,kind:'local invoice preflight/smoke; not hosted/DB/receiving acceptance',imageSha256:originals.map(original=>createHash('sha256').update(original).digest('hex')),schemaSha256:createHash('sha256').update(JSON.stringify(request.output_config?.format)).digest('hex'),promptSha256:createHash('sha256').update(JSON.stringify({system:request.system,text:request.messages[0].content instanceof Array?request.messages[0].content.filter(block=>block.type==='text'):request.messages[0].content})).digest('hex'),model:request.model,modelConfigured:!!model,photos:originals.length,views:images.length,maxRequests:1,maxRetries:0,maxOutputTokens:request.max_tokens,effort:request.output_config?.effort??'model default',thinking:request.thinking?.type??'model default/adaptive',transportVersion:(request.output_config?.format?.schema as any)?.properties?.version?.enum?.[0]??'unknown',imageSizes:invoiceImageSizes(images),timeoutMs:timeout,promptCharacters:String(request.system).length+JSON.stringify(request.messages[0].content instanceof Array?request.messages[0].content.filter(block=>block.type==='text'):request.messages[0].content).length,preparedBase64Characters:images.reduce((sum,image)=>sum+(image.source.type==='base64'?image.source.data.length:0),0),outputCapacityPrediction:'not available; preflight does not predict reasoning or certify photo accuracy'};
write('request-summary.json',summary);
write('schema.json',request.output_config?.format);
write('request-contract.json',{model:request.model,max_tokens:request.max_tokens,thinking:request.thinking??null,output_config:request.output_config,system:request.system,textBlocks:request.messages[0].content instanceof Array?request.messages[0].content.filter(block=>block.type==='text'):request.messages[0].content,viewMetadata:invoiceImageSizes(images)});
write('source-checkpoint.json',Object.fromEntries(['server/invoice-output.ts','server/invoice-image.ts','server/invoice-tables.ts','server/invoice-request.ts','server/invoice-economy.ts','server/invoice-records.ts','server/invoice-spend.ts'].map(file=>{const content=fs.readFileSync(file,'utf8');return [file,{sha256:createHash('sha256').update(content).digest('hex'),content}];})));
for(const [i,image] of images.entries())if(image.source.type==='base64')fs.writeFileSync(path.join(out,`view-${String(i+1).padStart(2,'0')}.jpg`),Buffer.from(image.source.data,'base64'),{flag:'wx',mode:0o600});
if(!send){console.log(JSON.stringify({...summary,status:'dry run; no network request'}));process.exit(0);}
const key=process.env.ANTHROPIC_API_KEY;
if(!model||!key?.startsWith('sk-ant-')||key.length<40||!/^[A-Za-z0-9_-]+$/.test(key))throw Error('Configure a full local Anthropic key and model; no request made');
write('started.json',{...summary,startedAt:new Date().toISOString()});
let paidStarted=false;
let stage:ExtractionStage='spend_preflight';
try{
 const client=new Anthropic({apiKey:key,maxRetries:0,timeout});
 const spend=await invoiceSpendPreflight(client,request);
 write('spend-reservation.json',spend);
 write('dispatched.json',{dispatchedAt:new Date().toISOString(),reservationUSD:spend.reservedUSD});
 stage='anthropic_request';paidStarted=true;
 const response=await client.messages.create({...request,model,service_tier:'standard_only'});
 write('response.json',{model:response.model,usage:response.usage,...invoiceOutputEvidence(response)});
 write('usage-cost.json',{estimatedUSD:invoiceUsageCost(response.model,response.usage),billingVerified:false,usage:response.usage});
 stage='structured_output';
 const extraction=readInvoiceOutput(response,invoiceImageSizes(images));
 if(new Set(extraction.rows.map(r=>r.sourceRow)).size!==extraction.rows.length)throw Error('Duplicate source row references');
 if(extraction.rows.some(r=>r.sourcePage>originals.length))throw Error('Invalid source page reference');
 write('extraction.json',extraction);
 stage='catalog_matching';
 // Catalog is used only AFTER extraction, exactly as in the worker.
 const products=loadPrivate(process.env.PRIVATE_FIXTURE_ROOT??'private').products;
 const rows=buildInvoiceRows(extraction,products);
 write('rows.json',rows);
 write('result.json',{...summary,status:'complete',stopReason:response.stop_reason,usage:response.usage,rows:rows.length,pending:rows.filter(r=>r.flags.length).length,finishedAt:new Date().toISOString()});
 console.log(JSON.stringify({status:'complete',rows:rows.length,pending:rows.filter(r=>r.flags.length).length,stopReason:response.stop_reason,usage:response.usage}));
}catch(error){
 const diagnostic=extractionFailure(error,paidStarted,stage);
 write('result.json',{...summary,...diagnostic,finishedAt:new Date().toISOString()});
 console.log(JSON.stringify(diagnostic));process.exitCode=1;
}
