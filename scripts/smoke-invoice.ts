// Explicit local diagnostic: one real photo request, no production DB writes.
// node --env-file=.env.local --import tsx scripts/smoke-invoice.ts IMAGE OUTPUT_DIR [--send]
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {invoiceRequest,prepareInvoiceImage} from '../server/invoice-request';
import {invoiceOutputEvidence,readInvoiceOutput} from '../server/invoice-output';
import {extractionFailure,type ExtractionStage} from '../server/extraction-failure';
import {buildInvoiceRows} from '../server/match-extraction';
import {loadPrivate} from './private-fixture';
import {limits} from '../server/config';
const [imageFile,outputDir,...flags]=process.argv.slice(2);
if(!imageFile||!outputDir||flags.some(f=>f!=='--send'))throw Error('Usage: smoke-invoice.ts IMAGE PRIVATE_OUTPUT_DIR [--send]');
const out=path.resolve(outputDir),privateRoot=fs.realpathSync('private');
if(!out.startsWith(privateRoot+path.sep))throw Error('Diagnostic output must stay inside private/');
// New directory only: never overwrite prior evidence or retry a started request.
fs.mkdirSync(out,{recursive:false,mode:0o700});
if(!fs.realpathSync(out).startsWith(privateRoot+path.sep))throw Error('Output path escapes private/');
const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
const original=fs.readFileSync(imageFile);
if(original.length>limits().maxUploadBytes)throw Error('Image too large');
const model=process.env.ANTHROPIC_MODEL;
let image:Anthropic.ImageBlockParam;
try{image=await prepareInvoiceImage(original);}catch(error){
 const diagnostic=extractionFailure(error,false,'image_validation');
 write('result.json',{kind:'local photo preflight; no provider request',...diagnostic,finishedAt:new Date().toISOString()});
 console.log(JSON.stringify(diagnostic));process.exit(1);
}
const request=invoiceRequest(model??'$ANTHROPIC_MODEL',[image]);
const summary={kind:'local photo smoke; not hosted/DB/receiving acceptance',imageSha256:createHash('sha256').update(original).digest('hex'),schemaSha256:createHash('sha256').update(JSON.stringify(request.output_config?.format)).digest('hex'),model:model??null,photos:1,maxRequests:1,maxRetries:0,maxOutputTokens:request.max_tokens};
write('request-summary.json',summary);
write('schema.json',request.output_config?.format);
if(!flags.includes('--send')){console.log(JSON.stringify({...summary,status:'dry run; no network request'}));process.exit(0);}
const key=process.env.ANTHROPIC_API_KEY;
if(!model||!key?.startsWith('sk-ant-')||key.length<40||!/^[A-Za-z0-9_-]+$/.test(key))throw Error('Configure a full local Anthropic key and model; no request made');
write('started.json',{...summary,startedAt:new Date().toISOString()});
let stage:ExtractionStage='anthropic_request';
try{
 const client=new Anthropic({apiKey:key,maxRetries:0,timeout:180000});
 const response=await client.messages.create({...request,model});
 write('response.json',{model:response.model,usage:response.usage,...invoiceOutputEvidence(response)});
 stage='structured_output';
 const extraction=readInvoiceOutput(response);
 if(new Set(extraction.rows.map(r=>r.sourceRow)).size!==extraction.rows.length)throw Error('Duplicate source row references');
 if(extraction.rows.some(r=>r.sourcePage>1))throw Error('Invalid source page reference');
 write('extraction.json',extraction);
 stage='catalog_matching';
 // Catalog is used only AFTER extraction, exactly as in the worker.
 const products=loadPrivate(process.env.PRIVATE_FIXTURE_ROOT??'private').products;
 const rows=buildInvoiceRows(extraction,products);
 write('rows.json',rows);
 write('result.json',{...summary,status:'complete',stopReason:response.stop_reason,usage:response.usage,rows:rows.length,pending:rows.filter(r=>r.flags.length).length,finishedAt:new Date().toISOString()});
 console.log(JSON.stringify({status:'complete',rows:rows.length,pending:rows.filter(r=>r.flags.length).length,stopReason:response.stop_reason,usage:response.usage}));
}catch(error){
 const diagnostic=extractionFailure(error,true,stage);
 write('result.json',{...summary,...diagnostic,finishedAt:new Date().toISOString()});
 console.log(JSON.stringify(diagnostic));process.exitCode=1;
}
