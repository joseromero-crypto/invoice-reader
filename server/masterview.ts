import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {check,HttpError} from './auth';
import {MV_CITY_COLUMNS,MV_PRODUCT_COLUMNS,citySlug,parseMasterviewFile} from '../shared/catalog.ts';
import {buildLatest,importPayload,planImport,type MvState} from '../shared/masterview.ts';
const MAX_FILE=15000000;
export const latestCsv=(city:string)=>`masterview/${citySlug(city)}/latest.csv`;
const UNSURE='No se pudo confirmar si se guardó. Espera un minuto, recarga y revisa "Última actualización" antes de subir otra vez.';
const JOB_PATH='masterview/job.json';
export type MvJob={id:string;state:'running'|'done'|'failed';startedAt:string;finishedAt?:string;error?:string;version?:string;published?:boolean;committed?:boolean;unsure?:boolean};
// The background function can't answer the browser, so the job's state lives next to the CSVs. One file: one import at a time.
export async function readJob(db:SupabaseClient):Promise<MvJob|null>{const {data,error}=await db.storage.from('catalogs').download(JOB_PATH);if(error&&!missing(error))throw new HttpError(503,'No se pudo leer el estado de la importación.');return data?JSON.parse(await data.text()):null;}
export async function writeJob(db:SupabaseClient,job:MvJob){check(await db.storage.from('catalogs').upload(JOB_PATH,new Blob([JSON.stringify(job)],{type:'text/plain'}),{contentType:'text/plain',upsert:true}));}
const missing=(error:any)=>/not.?found/i.test(error?.message??'')||String(error?.statusCode??error?.status)==='404';
// The project can answer 5xx/429 or time out for a minute or so after a big write (Nov 11). Every step below is safe to repeat.
export const RETRY_WAITS=[3000,10000,20000,30000,60000,60000];
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export async function patient<T>(step:()=>Promise<T>,wait=sleep):Promise<T>{
 for(let i=0;;i++)try{return await step();}catch(e){if(i>=RETRY_WAITS.length||e instanceof HttpError&&(e.final||[401,403,409].includes(e.status)))throw e;await wait(RETRY_WAITS[i]);}
}
export async function mvState(db:SupabaseClient):Promise<MvState>{return check(await db.rpc('read_mv_state'))!;}
async function readCsv(db:SupabaseClient,path:string){
 const blob=check(await db.storage.from('catalogs').download(path))!;if(blob.size>MAX_FILE)throw new HttpError(400,'CSV demasiado grande. Máximo 15 MB.',true);
 const bytes=await blob.arrayBuffer();
 try{return {path,bytes,csv:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};}catch{throw new HttpError(400,'Exporta Masterview como CSV UTF-8.',true);}
}
// All-or-nothing: nothing reaches the tables unless every file passes. Moving the files and publishing come after (finishImport).
export async function importMasterview(db:SupabaseClient,actor:string,options:{paths:string[];confirmDrop?:boolean},wait=sleep){
 const sources=await patient(()=>Promise.all(options.paths.map(path=>readCsv(db,path))),wait);
 const files=sources.map(s=>parseMasterviewFile(s.csv,s.path.split('/').pop()));
 const state=await patient(()=>mvState(db),wait),plan=planImport(files,state,{confirmDrop:options.confirmDrop});
 if(plan.errors.length||!plan.report)throw new HttpError(400,plan.errors.slice(0,8).join(' '),true);
 const hash=createHash('sha256').update(JSON.stringify([MV_PRODUCT_COLUMNS,MV_CITY_COLUMNS,sources.map(s=>createHash('sha256').update(s.csv).digest('hex')).sort()])).digest('hex');
 const report={...plan.report,files:files.map((f,i)=>({city:f.city,rows:f.rows.length,path:sources[i].path})),acceptedDrops:plan.drops};
 const before=state.imports?.find(i=>i.id===state.version)?.uploaded_at;
 // The answer can be lost after the commit. Our hash as the newest import, with a new date, means it was saved.
 const committed=async()=>{const last=check(await db.from('mv_imports').select('id,uploaded_at,source_hash').order('uploaded_at',{ascending:false}).limit(1).maybeSingle()) as any;return last?.source_hash===hash&&last.uploaded_at&&(!before||Date.parse(last.uploaded_at)!==Date.parse(before))?{version:last.id as string,uploadedAt:last.uploaded_at as string}:null;};
 const result=await patient(async()=>{
  const {data,error}=await db.rpc('import_mv',{p_actor:actor,p_hash:hash,p_report:report,p_expected:state.version,...importPayload(plan)});
  if(!error)return data as {version:string;uploadedAt:string};
  const saved=await committed();if(saved)return saved;
  // A conflict, a bad row or missing permission won't change by asking again.
  if(/Revision conflict|administrator required|Empty import|outside the uploaded/.test(error.message??'')||/^2[23]/.test(error.code??''))throw new HttpError(409,/Revision conflict/.test(error.message)?'Otra importación cambió Masterview. Vuelve a subir los archivos.':error.message,true);
  throw new HttpError(503,UNSURE);
 },wait);
 return {...result,report};
}
// Moves the newest import's uploaded files to latest.csv. Safe to run again: a file already moved is skipped.
export const moveFiles=(db:SupabaseClient,wait=sleep)=>patient(async()=>{
  const last=check(await db.from('mv_imports').select('report').order('uploaded_at',{ascending:false}).limit(1).maybeSingle()) as any;
  for(const f of (last?.report?.files??[]) as {city:string;path:string}[]){const target=latestCsv(f.city);if(f.path===target)continue;
   const bucket=db.storage.from('catalogs'),{data,error}=await bucket.download(f.path);if(error){if(missing(error))continue;throw new HttpError(503,error.message);}
   check(await bucket.upload(target,await data.arrayBuffer(),{contentType:'text/csv',upsert:true}));check(await bucket.remove([f.path]));}
},wait);
export async function finishImport(db:SupabaseClient,wait=sleep){await moveFiles(db,wait);return patient(()=>publishMasterview(db),wait);}
// latest.json first and version.txt last: a reader that sees the new version always finds the new file.
export async function publishMasterview(db:SupabaseClient){
 const [state,hubs]=await Promise.all([mvState(db),db.from('hubs').select('name,city,active').then(r=>check(r)!)]);
 const latest=buildLatest(state,hubs);if(!latest.updatedAt)throw new HttpError(409,'Masterview no tiene importaciones.',true);
 check(await db.storage.from('masterview').upload('latest.json',new Blob([JSON.stringify(latest)],{type:'application/json'}),{contentType:'application/json',upsert:true,cacheControl:'60'}));
 check(await db.storage.from('masterview').upload('version.txt',new Blob([latest.updatedAt],{type:'text/plain'}),{contentType:'text/plain',upsert:true,cacheControl:'60'}));
 return {version:latest.version,updatedAt:latest.updatedAt,count:latest.count};
}
// One background run: import, move, publish, and leave the outcome for the screen. No paths = only finish the last import.
export async function runJob(db:SupabaseClient,actor:string,job:MvJob,options:{paths:string[];confirmDrop?:boolean},wait=sleep){
 const end=(result:Partial<MvJob>)=>patient(()=>writeJob(db,{...job,...result,finishedAt:new Date().toISOString()} as MvJob),wait);
 let version:string|undefined;
 if(options.paths.length)try{version=(await importMasterview(db,actor,options,wait)).version;}catch(e){
  // The import may still commit on its own, so its files stay.
  if(e instanceof HttpError&&e.message===UNSURE){await end({state:'failed',unsure:true,error:e.message});return;}
  await db.storage.from('catalogs').remove(options.paths.filter(p=>!p.endsWith('/latest.csv'))).catch(()=>{});
  await end({state:'failed',error:e instanceof HttpError?e.message:'La importación falló; no se cambió el catálogo.'});return;
 }
 try{const published=await finishImport(db,wait);await end({state:'done',version:version??published.version??undefined,published:true});}
 catch{await end({state:'failed',committed:true,version,error:'Masterview se guardó, pero falta publicarlo para las otras apps. Espera un minuto y toca "Terminar de publicar".'});}
}
