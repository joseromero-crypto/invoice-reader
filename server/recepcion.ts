import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {match} from '../lean/match.ts';
import {receptionRows} from '../lean/reception.ts';
import type {Transcription} from '../lean/transcribe.ts';
import {adminClient,check,HttpError} from './auth';
import {limits} from './config';
import {catalog,cityItems,hubCity} from './workspace';
import {leanMappings} from './rematch';

// mh-recibo (static page, anon key, no user sign-in) sends reception photos here and reads the result back.
// Reads made this way run as one service account (RECEPCION_ACTOR_ID: an admin member with no password anyone knows),
// so the worker's claim/finish functions and extraction_jobs.requested_by work unchanged.

export const MAX_READS_PER_SESSION=10;
const SESSION_HOURS=24,LIST_DAYS=7;

// mh-recibo's hub slug ↔ hubs.name: "MH San Nicolás" → "mh-san-nicolas". Its test hub is our "Pruebas de facturas".
export const hubSlug=(name:string)=>name==='Pruebas de facturas'?'test-hub':name.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export function hubForSlug<H extends {name:string}>(hubs:H[],slug:string):H|null{const found=hubs.filter(h=>hubSlug(h.name)===slug);return found.length===1?found[0]:null;}

export interface RecEvent {id:number;tipo:string;hub:string;ts:string;receptor:string|null;detalle:any}
// A session is real and current when: its id starts with a hub slug we know, it has an 'abrir' event from the last 24 h
// for that hub, and the last admin delete/reopen isn't a 'borrar' (a reopen after a delete brings it back).
export function checkSession<H extends {name:string}>(sessionId:string,events:RecEvent[],hubs:H[],now=Date.now()):{hub:H;receptor:string|null}{
 const slug=sessionId.split('__')[0]??'',hub=hubForSlug(hubs,slug);
 if(!hub)throw new HttpError(404,'Hub de mh-recibo desconocido.');
 const sorted=[...events].sort((a,b)=>a.id-b.id);
 const opened=sorted.filter(e=>e.tipo==='abrir'&&e.hub===slug).at(-1);
 if(!opened)throw new HttpError(404,'Recepción no encontrada.');
 if(now-new Date(opened.ts).getTime()>SESSION_HOURS*3600e3)throw new HttpError(410,'La recepción tiene más de 24 horas.');
 const admin=sorted.filter(e=>e.tipo==='admin'&&['borrar','reabrir'].includes(e.detalle?.accion)).at(-1);
 if(admin?.detalle?.accion==='borrar')throw new HttpError(410,'La recepción fue borrada.');
 return {hub,receptor:opened.receptor??null};
}

// CORS: only the origins in MH_RECIBO_ORIGIN (comma-separated). A request from any other origin, or with none, is refused.
export const allowedOrigins=(env=process.env.MH_RECIBO_ORIGIN)=>(env??'').split(',').map(s=>s.trim().replace(/\/$/,'')).filter(Boolean);
export function corsHeaders(origin:string|null,env=process.env.MH_RECIBO_ORIGIN):Record<string,string>|null{
 if(!origin||!allowedOrigins(env).includes(origin))return null;
 return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600',Vary:'Origin'};
}

// The dispatch to extract-background carries this instead of a user's JWT.
export const workerSignature=(jobId:string,key=process.env.SUPABASE_SECRET_KEY)=>{if(!key)throw new HttpError(503,'Supabase server configuration missing');return createHmac('sha256',key).update(`recepcion:${jobId}`).digest('hex');};
export function signedWorker(request:Request,jobId:string){
 const sig=request.headers.get('x-recepcion-signature');if(!sig)return false;
 const want=Buffer.from(workerSignature(jobId)),got=Buffer.from(sig);
 if(want.length!==got.length||!timingSafeEqual(want,got))throw new HttpError(401,'Invalid signature');
 return true;
}
export function recepcionActor(){const id=process.env.RECEPCION_ACTOR_ID;if(!id)throw new HttpError(503,'Falta RECEPCION_ACTOR_ID.');return id;}
async function actorOrg(db:SupabaseClient,actor:string){
 const m=check(await db.from('members').select('org_id,role').eq('user_id',actor))!;
 if(m.length!==1||m[0].role!=='admin')throw new HttpError(503,'RECEPCION_ACTOR_ID debe ser un admin de una sola organización.');
 return m[0].org_id as string;
}
async function sessionHub(db:SupabaseClient,orgId:string,sessionId:string){
 const events=check(await db.from('rec_events').select('id,tipo,hub,ts,receptor,detalle').eq('session_id',sessionId).in('tipo',['abrir','admin']).order('id'))! as RecEvent[];
 const hubs=check(await db.from('hubs').select('id,name').eq('org_id',orgId).eq('active',true))!;
 return checkSession(sessionId,events,hubs);
}
const pagePath=(orgId:string,documentId:string,n:number)=>`${orgId}/${documentId}/page-${n}`;
const isPhoto=(b:Buffer)=>(b[0]===0xff&&b[1]===0xd8)||(b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47)||(b.subarray(0,4).toString('latin1')==='RIFF'&&b.subarray(8,12).toString('latin1')==='WEBP');

export async function start(sessionId:string,photoCount:number){
 const db=adminClient(),actor=recepcionActor(),orgId=await actorOrg(db,actor);
 const {hub}=await sessionHub(db,orgId,sessionId);
 // Abuse guard for an endpoint anyone can call: not a spend fence (a hub may legitimately re-read a few times).
 const {count,error}=await db.from('documents').select('id',{count:'exact',head:true}).eq('org_id',orgId).eq('external_ref',sessionId);if(error)throw error;
 if((count??0)>=MAX_READS_PER_SESSION)throw new HttpError(429,`Ya hay ${MAX_READS_PER_SESSION} lecturas en esta recepción.`);
 const session=check(await db.from('receiving_sessions').insert({org_id:orgId,hub_id:hub.id,created_by:actor}).select('id').single())!;
 const document=check(await db.from('documents').insert({org_id:orgId,session_id:session.id,purpose:'recepcion',external_ref:sessionId}).select('id').single())!;
 const uploads=[];
 for(let n=1;n<=photoCount;n++){const path=pagePath(orgId,document.id,n),u=check(await db.storage.from('invoices').createSignedUploadUrl(path))!;uploads.push({page:n,signedUrl:u.signedUrl,token:u.token,path});}
 return {documentId:document.id,uploads};
}

// Registers the uploaded photos (hash checked again by the worker) and dispatches the read the same way the app does.
export async function submit(request:Request,sessionId:string,documentId:string){
 const db=adminClient(),actor=recepcionActor(),orgId=await actorOrg(db,actor);
 const document=check(await db.from('documents').select('id,session_id').eq('org_id',orgId).eq('id',documentId).eq('external_ref',sessionId).eq('purpose','recepcion').maybeSingle());if(!document)throw new HttpError(404,'Lectura no encontrada.');
 let job=check(await db.from('extraction_jobs').select('*').eq('org_id',orgId).eq('document_id',documentId).maybeSingle());
 if(job&&job.status!=='failed'&&job.status!=='uncertain')return {status:job.status};
 if(!process.env.ANTHROPIC_API_KEY)throw new HttpError(503,'Anthropic configuration missing');
 const existing=check(await db.from('source_pages').select('page_number').eq('org_id',orgId).eq('document_id',documentId))!;
 if(!existing.length){
  for(let n=1;n<=limits().maxPages;n++){
   const got=await db.storage.from('invoices').download(pagePath(orgId,documentId,n));if(got.error||!got.data)break;
   if(got.data.size>limits().maxUploadBytes)throw new HttpError(400,'Foto demasiado grande.');
   const buffer=Buffer.from(await got.data.arrayBuffer());if(!isPhoto(buffer))throw new HttpError(400,'La foto no es JPG, PNG ni WebP.');
   check(await db.from('source_pages').insert({org_id:orgId,document_id:documentId,object_path:pagePath(orgId,documentId,n),content_hash:createHash('sha256').update(buffer).digest('hex'),page_number:n}));
  }
  const pages=check(await db.from('source_pages').select('id').eq('org_id',orgId).eq('document_id',documentId))!;if(!pages.length)throw new HttpError(400,'Sube al menos una foto.');
 }
 if(job)job=check(await db.from('extraction_jobs').update({status:'queued',error:null,requested_by:actor,created_at:new Date().toISOString()}).eq('org_id',orgId).eq('id',job.id).in('status',['failed','uncertain']).select().single())!;
 else{const created=await db.from('extraction_jobs').insert({org_id:orgId,document_id:documentId,requested_by:actor}).select().single();if(created.error?.code==='23505')return {status:'queued'};job=check(created)!;}
 const dispatched=await fetch(new URL('/.netlify/functions/extract-background',request.url),{method:'POST',headers:{'X-Recepcion-Signature':workerSignature(job.id),'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id})});
 if(!dispatched.ok){check(await db.from('extraction_jobs').update({status:'failed',error:'Background dispatch failed'}).eq('org_id',orgId).eq('id',job.id).eq('status','queued'));throw new HttpError(503,'No se pudo iniciar la lectura.');}
 return {status:'queued'};
}

// Reads saved before matchKeys existed are rebuilt from the saved transcription and the current catalog (free).
async function withMatchKeys(db:SupabaseClient,orgId:string,reads:any[]){
 const stale=reads.filter(r=>r.status==='done'&&r.rows.some((row:any)=>!Array.isArray(row.matchKeys)));if(!stale.length)return reads;
 const jobs=check(await db.from('extraction_jobs').select('document_id,raw_result').eq('org_id',orgId).in('document_id',stale.map(r=>r.read_id)))!;
 const mappingsFor=new Map<string,any>();
 for(const read of stale){
  const t=jobs.find(j=>j.document_id===read.read_id)?.raw_result?.transcription as Transcription|undefined;if(!t)continue;
  const city=await hubCity(db,read.hub_id);
  if(!mappingsFor.has(String(city))){const raw=await catalog(db,city);mappingsFor.set(String(city),{items:cityItems(raw,city),mappings:await leanMappings(db,orgId,raw)});}
  const {items,mappings}=mappingsFor.get(String(city));
  read.rows=receptionRows(t,match(t,items,mappings,{mode:'recepcion'}),items);
 }
 return reads;
}
export async function readSession(sessionId:string){
 const db=adminClient(),orgId=await actorOrg(db,recepcionActor());
 const reads=check(await db.rpc('reception_reads',{p_external_ref:sessionId}))! as any[];
 return {reads:await withMatchKeys(db,orgId,reads)};
}
// Reads scanned in Invoice Reader (no external_ref) for that hub, so mh-recibo can offer one when none is linked.
export async function listHub(slug:string,since:string|null){
 const db=adminClient(),orgId=await actorOrg(db,recepcionActor());
 const hub=hubForSlug(check(await db.from('hubs').select('id,name').eq('org_id',orgId).eq('active',true))!,slug);if(!hub)throw new HttpError(404,'Hub de mh-recibo desconocido.');
 const floor=Date.now()-LIST_DAYS*864e5,from=new Date(Math.max(floor,since?new Date(since).getTime():floor)).toISOString();
 const reads=(check(await db.rpc('reception_reads',{p_hub_id:hub.id,p_since:from}))! as any[]).filter(r=>!r.external_ref);
 return {reads:await withMatchKeys(db,orgId,reads)};
}
