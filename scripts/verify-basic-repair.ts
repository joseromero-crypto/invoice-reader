import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readInvoiceOutput} from '../server/invoice-output';
import {buildInvoiceRows} from '../server/match-extraction';
import {loadPrivate} from './private-fixture';
const root='private/testing/basic-sonnet-repair-20261030',parent='private/testing/basic-sonnet-20261030';
const json=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=(s:Buffer)=>createHash('sha256').update(s).digest('hex');
const before=json(`${root}/preservation-before.json`);let preserved=0;
for(const [file,hash] of Object.entries(before)){assert.equal(sha(fs.readFileSync(file)),hash,file);preserved++;}
const products=loadPrivate('private').products,stable=(rows:any[])=>rows.map(({id,...row})=>row),replays=[];
for(const id of [2,3,4,6,7,10,11,13]){
 const dir=`${parent}/${String(id).padStart(2,'0')}`,parsed=readInvoiceOutput(json(`${dir}/response.json`),json(`${dir}/view-metadata.json`),'basic-v1');
 assert.deepEqual(parsed,json(`${dir}/extraction.json`));const core=(rows:any[])=>rows.map(({id,raw,sourceDetails,annotationAssociation,quantityAlignment,...row})=>row);assert.deepEqual(core(buildInvoiceRows(parsed,products)),core(json(`${dir}/rows.json`)));replays.push(id);
}
const retryReplays=[];
for(const name of fs.readdirSync(root).filter(n=>/^\d\d-attempt-2$/.test(n))){
 const dir=`${root}/${name}`;
 if(fs.existsSync(`${dir}/extraction.json`)){const parsed=readInvoiceOutput(json(`${dir}/response.json`),json(`${dir}/view-metadata.json`),'basic-v3');assert.deepEqual(parsed,json(`${dir}/extraction.json`));const current=buildInvoiceRows(parsed,products),saved=json(`${dir}/rows.json`),core=(r:any[])=>stable(r).map(({flags,...row})=>name.startsWith('12')?(({conversion,...rest})=>rest)(row):row);assert.deepEqual(core(current),core(saved));const changes=current.filter((r,i)=>JSON.stringify(r.flags)!==JSON.stringify(saved[i].flags)).map(r=>r.sourceRow);assert.deepEqual(changes,name.startsWith('08')?[1,2,3,4,5,6,7,8,9]:name.startsWith('12')?Array.from({length:14},(_,i)=>i+1):[]);fs.writeFileSync(`${dir}/current-matching-audit-${Date.now()}.json`,JSON.stringify({sourceAuditSha256:sha(fs.readFileSync('server/match-extraction.ts')),rows:current,changedReviewRows:changes},null,2),{flag:'wx',mode:0o600});retryReplays.push({name,changedReviewRows:changes});}
 else if(fs.existsSync(`${dir}/response.json`))assert.throws(()=>readInvoiceOutput(json(`${dir}/response.json`),json(`${dir}/view-metadata.json`),'basic-v2'));
}
const photos=json(`${parent}/campaign.json`).invoices.flatMap((i:any)=>i.photos);for(const p of photos)assert.equal(sha(fs.readFileSync(p.path)),p.sha256);
const result={at:new Date().toISOString(),priorPrivateFilesHashIdentical:preserved,originalPhotoHashesMatch:photos.length,basicV1SourceParseExactAndMatchingCoreIdentical:replays,basicV3ReplaysExact:retryReplays,failedV2StillRejected:true};
fs.writeFileSync(`${root}/verification-${Date.now()}.json`,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
