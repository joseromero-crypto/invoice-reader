import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildInvoiceRows} from '../server/match-extraction';
import {loadPrivate} from './private-fixture';
import {ExtractionSchema} from '../shared/domain';
import {encodeInvoiceTableOutput,readInvoiceOutput} from '../server/invoice-output';
import {invoiceTablesToRecords} from '../server/invoice-records';
const root='private/testing/basic-sonnet-20261030',repo=process.cwd();
const before=JSON.parse(fs.readFileSync(`${root}/preservation-before.json`,'utf8'));
const sha=(s:Buffer|string)=>createHash('sha256').update(s).digest('hex');
const priorMatch=execFileSync('git',['show','HEAD:server/match-extraction.ts'],{encoding:'utf8'});assert.equal(sha(priorMatch),before['server/match-extraction.ts']);
const temporary=`/private/tmp/basic-prior-match-${Date.now()}.ts`;
fs.writeFileSync(temporary,priorMatch.replaceAll("'../shared/",`'${repo}/shared/`),{flag:'wx'});
const oldBuild=(await import(temporary)).buildInvoiceRows,products=loadPrivate('private').products;
let invoices=0,rows=0;const groups=[];
const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='id'||!('sourceRow' in v)).map(([k,v])=>[k,stable(v)])):v;
for(const set of ['targeted-live-20261029','rerun-20261028','clear-photos-20261028']){
 const seen=new Set();let count=0;
 for(const file of fs.readdirSync(`private/testing/${set}`).filter(f=>f.endsWith('.json'))){
  const saved=JSON.parse(fs.readFileSync(`private/testing/${set}/${file}`,'utf8'));if(!saved?.job?.raw_result||!Array.isArray(saved.rows))continue;
  const key=saved.job.id??saved.job.document_id;if(!key||seen.has(key))continue;seen.add(key);
  const original=ExtractionSchema.parse(saved.job.raw_result),serialized=JSON.stringify(original);
  assert.deepEqual(stable(buildInvoiceRows(original,products)),stable(oldBuild(original,products)),file);assert.equal(JSON.stringify(original),serialized);
  const value={...original,annotationEvidence:original.annotationEvidence??{rows:[],marks:[]},quantityEvidence:original.quantityEvidence??{rows:[],cells:[]},rows:original.rows.map(r=>({...r,reception:r.reception??{kind:'none',text:null,quantity:null},fieldUncertainties:r.fieldUncertainties??[],receptionMarked:r.receptionMarked??false}))};
  const sizes=Array.from({length:Math.max(...value.rows.map(r=>r.sourcePage))},(_,i)=>({width:1,height:1,sourcePage:i+1}));
  const table=encodeInvoiceTableOutput(value,sizes);for(const wire of [table,invoiceTablesToRecords(table)])assert.deepEqual(readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(wire),citations:null}]},sizes),value);
  rows+=original.rows.length;count+=original.rows.length;invoices++;
 }
 groups.push({set,invoices:seen.size,rows:count});
}
let preserved=0;for(const [file,hash] of Object.entries(before)){if(file.startsWith('private/')){assert.equal(sha(fs.readFileSync(file)),hash,file);preserved++;}}
const report={invoices,rows,groups,historicalMatchingIdentical:true,bothCodecRoundTrips:true,legacyScaffolding:'in memory only for codec QA; no fabricated fresh evidence',priorPrivateFilesHashIdentical:preserved};
fs.writeFileSync(`${root}/unpaid-history-${Date.now()}.json`,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
