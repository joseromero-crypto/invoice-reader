import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {check,HttpError} from './auth';
import {MV_CITY_COLUMNS,MV_PRODUCT_COLUMNS,citySlug,parseMasterviewFile} from '../shared/catalog.ts';
import {buildLatest,importPayload,planImport,type MvState} from '../shared/masterview.ts';
const MAX_FILE=15000000;
export const latestCsv=(city:string)=>`masterview/${citySlug(city)}/latest.csv`;
const JOB_PATH='masterview/job.json';
export type MvJob={id:string;state:'running'|'done'|'failed';startedAt:string;finishedAt?:string;error?:string;version?:string;published?:boolean};
// The background function can't answer the browser, so the job's state lives next to the CSVs. One file: one import at a time.
export async function readJob(db:SupabaseClient):Promise<MvJob|null>{const {data,error}=await db.storage.from('catalogs').download(JOB_PATH);if(error||!data)return null;return JSON.parse(await data.text());}
export async function writeJob(db:SupabaseClient,job:MvJob){check(await db.storage.from('catalogs').upload(JOB_PATH,new Blob([JSON.stringify(job)],{type:'text/plain'}),{contentType:'text/plain',upsert:true}));}
export async function mvState(db:SupabaseClient):Promise<MvState>{return check(await db.rpc('read_mv_state'))!;}
async function readCsv(db:SupabaseClient,path:string){
 const blob=check(await db.storage.from('catalogs').download(path))!;if(blob.size>MAX_FILE)throw new HttpError(400,'CSV demasiado grande. Máximo 15 MB.');
 const bytes=await blob.arrayBuffer();
 try{return {path,bytes,csv:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};}catch{throw new HttpError(400,'Exporta Masterview como CSV UTF-8.');}
}
// All-or-nothing: nothing reaches the tables unless every file passes, and latest.csv changes only after the import committed.
export async function importMasterview(db:SupabaseClient,actor:string,options:{paths:string[];confirmDrop?:boolean}){
 const sources=await Promise.all(options.paths.map(path=>readCsv(db,path)));
 const files=sources.map(s=>parseMasterviewFile(s.csv,s.path.split('/').pop()));
 const state=await mvState(db),plan=planImport(files,state,{confirmDrop:options.confirmDrop});
 if(plan.errors.length||!plan.report)throw new HttpError(400,plan.errors.slice(0,8).join(' '));
 const hash=createHash('sha256').update(JSON.stringify([MV_PRODUCT_COLUMNS,MV_CITY_COLUMNS,sources.map(s=>createHash('sha256').update(s.csv).digest('hex')).sort()])).digest('hex');
 const report={...plan.report,files:files.map((f,i)=>({city:f.city,rows:f.rows.length,path:sources[i].path})),acceptedDrops:plan.drops};
 const result=check(await db.rpc('import_mv',{p_actor:actor,p_hash:hash,p_report:report,p_expected:state.version,...importPayload(plan)})) as {version:string;uploadedAt:string};
 await Promise.all(sources.map(async(s,i)=>{const target=latestCsv(files[i].city!);if(s.path===target)return;
  check(await db.storage.from('catalogs').upload(target,s.bytes,{contentType:'text/csv',upsert:true}));
  check(await db.storage.from('catalogs').remove([s.path]));}));
 return {...result,report};
}
// latest.json first and version.txt last: a reader that sees the new version always finds the new file.
export async function publishMasterview(db:SupabaseClient){
 const [state,hubs]=await Promise.all([mvState(db),db.from('hubs').select('name,city,active').then(r=>check(r)!)]);
 const latest=buildLatest(state,hubs);if(!latest.updatedAt)throw new HttpError(409,'Masterview no tiene importaciones.');
 check(await db.storage.from('masterview').upload('latest.json',new Blob([JSON.stringify(latest)],{type:'application/json'}),{contentType:'application/json',upsert:true,cacheControl:'60'}));
 check(await db.storage.from('masterview').upload('version.txt',new Blob([latest.updatedAt],{type:'text/plain'}),{contentType:'text/plain',upsert:true,cacheControl:'60'}));
 return {version:latest.version,updatedAt:latest.updatedAt,count:latest.count};
}
// One background run: import, publish, and leave the outcome for the screen to read.
export async function runJob(db:SupabaseClient,actor:string,job:MvJob,options:{paths:string[];confirmDrop?:boolean}){
 try{
  const result=await importMasterview(db,actor,options);await publishMasterview(db);
  await writeJob(db,{...job,state:'done',finishedAt:new Date().toISOString(),version:result.version,published:true});
 }catch(e){
  await db.storage.from('catalogs').remove(options.paths.filter(p=>!p.endsWith('/latest.csv'))).catch(()=>{});
  await writeJob(db,{...job,state:'failed',finishedAt:new Date().toISOString(),error:e instanceof HttpError?e.message:'La importación falló; no se cambió el catálogo.'});
 }
}
