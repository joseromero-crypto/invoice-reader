import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {prepareBasicInvoicePage,invoiceImageSizes} from '../server/invoice-image';
import {basicInvoiceRequest} from '../server/invoice-basic';
import {invoiceSpendPreflight} from '../server/invoice-spend';
import {readInvoiceOutput} from '../server/invoice-output';
import {buildInvoiceRows} from '../server/match-extraction';
import {loadPrivate} from './private-fixture';
const root='private/testing/basic-sonnet-20261030';
const json=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p:string,v:unknown)=>fs.writeFileSync(p,JSON.stringify(v,null,2),{flag:'wx'});
const model=process.env.ANTHROPIC_MODEL!;
const client=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:0});
const refusalCounts=[];
for(const id of [5,8,9,12]){
 const dir=`${root}/${String(id).padStart(2,'0')}`,request=json(`${dir}/refused-request.json`);
 const counted=await client.messages.countTokens({model:request.model,system:request.system,messages:request.messages,output_config:request.output_config,thinking:request.thinking});
 const padded=Math.ceil(counted.input_tokens*1.2)+1024;
 const affordable=Math.floor((.099-padded*2/1e6)*1e5)-1;
 refusalCounts.push({invoice:id,exactCount:counted,paddedInput:padded,reservedInputUSD:padded*2/1e6,affordableOutputTokens:affordable,requiredUsefulOutputTokens:id===9?4200:3200,generationCalls:0});
}
write(`${root}/refusal-token-count-verification.json`,refusalCounts);
const equivalence=[];
for(const id of [2,3,4,6,7,10,11,13]){
 const dir=`${root}/${String(id).padStart(2,'0')}`,sources=json(`${dir}/originals.json`),saved=json(`${dir}/request.json`),reservation=json(`${dir}/reservation.json`);
 const images=[];
 for(const [i,source] of sources.entries())images.push(...await prepareBasicInvoicePage(fs.readFileSync(source.path),model,i+1,sources.length<3));
 const sizes=invoiceImageSizes(images),current=basicInvoiceRequest(model,images,sizes,sources.length);
 let matches=false,reason=null;
 try{await invoiceSpendPreflight({messages:{countTokens:async()=>({input_tokens:reservation.estimatedInputTokens})}} as any,current,undefined,sources.length);matches=JSON.stringify(current)===JSON.stringify(saved);}catch(e){reason=(e as Error).message;}
 const raw=json(`${dir}/response.json`),parsed=readInvoiceOutput(raw,json(`${dir}/view-metadata.json`),'basic-v1');
 assert.deepEqual(parsed,json(`${dir}/extraction.json`));
 const rows=buildInvoiceRows(parsed,loadPrivate('private').products),prior=json(`${dir}/rows.json`);
 const core=(v:any[])=>v.map(({id,raw,sourceDetails,annotationAssociation,quantityAlignment,...r})=>r);
 assert.deepEqual(core(rows),core(prior));
 equivalence.push({invoice:id,currentRequestByteIdentical:matches,reason,originalRequestSchema:saved.output_config.format.schema.properties.version.enum[0],strictReplayExact:true,currentMatchingCoreIdentical:true});
}
write(`${root}/current-equivalence.json`,equivalence);
const before=json(`${root}/preservation-before.json`);let count=0;
for(const [file,hash] of Object.entries(before))if(file.startsWith('private/')){assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,file);count++;}
write(`${root}/preservation-final.json`,{priorPrivateFilesHashIdentical:count,noOriginalPrivateFilesModified:true,all24SourcePhotoHashesMatchManifest:json(`${root}/campaign.json`).invoices.flatMap((i:any)=>i.photos).every((p:any)=>createHash('sha256').update(fs.readFileSync(p.path)).digest('hex')===p.sha256)});
console.log(JSON.stringify({refusalCounts,equivalence,preserved:count}));
