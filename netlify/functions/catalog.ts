import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {authorize,check,failure,HttpError} from '../../server/auth';
import {citySlug} from '../../shared/catalog';
import {latestCsv,readJob,writeJob} from '../../server/masterview';
const STALE_JOB=15*60000;
const Input=z.discriminatedUnion('action',[
 z.object({action:z.literal('status')}),
 z.object({action:z.literal('prepare'),cities:z.array(z.string().trim().min(1).max(80)).min(1).max(8)}),
 z.object({action:z.literal('start'),paths:z.array(z.string().max(200)).min(1).max(8),confirmDrop:z.boolean()}),
 z.object({action:z.literal('reread'),confirmDrop:z.boolean()})]);
export default async function handler(request:Request){try{
 if(request.method!=='POST')throw new HttpError(405,'POST required');
 const {db,role,token}=await authorize(request);
 if(role!=='admin')throw new HttpError(403,'Se requiere acceso de administrador para Masterview.');
 const parsed=Input.safeParse(await request.json());if(!parsed.success)throw new HttpError(400,'Solicitud de Masterview inválida.');const b=parsed.data;
 const cities=async()=>{const rows=check(await db.rpc('mv_city_status'))! as {city:string;rows:number;updated_at:string}[];return rows;};
 if(b.action==='status'){
 const [list,last,job]=await Promise.all([cities(),db.from('mv_imports').select('id,uploaded_at,uploaded_by,report').order('uploaded_at',{ascending:false}).limit(1).maybeSingle().then(r=>check(r)),readJob(db)]);
 const email=last?.uploaded_by?(await db.auth.admin.getUserById(last.uploaded_by)).data.user?.email??null:null;
 return Response.json({cities:list,last:last?{...last,uploaded_by:email}:null,job});
 }
 // Files go straight from the browser to a private path; the import moves them to latest.csv only if it succeeds.
 if(b.action==='prepare'){
 const uploads=await Promise.all(b.cities.map(async city=>{const path=`masterview/${citySlug(city)}/incoming-${randomUUID()}.csv`;const signed=check(await db.storage.from('catalogs').createSignedUploadUrl(path))!;return {city,path,token:signed.token};}));
 return Response.json({uploads});
 }
 const current=await readJob(db);if(current?.state==='running'&&Date.now()-new Date(current.startedAt).getTime()<STALE_JOB)throw new HttpError(409,'Ya hay una importación en curso.');
 const paths=b.action==='reread'?(await cities()).map(c=>latestCsv(c.city)):b.paths;
 if(!paths.length)throw new HttpError(409,'Todavía no hay archivos guardados.');
 if(paths.some(p=>!/^masterview\/[a-z0-9-]+\/(latest|incoming-[a-f0-9-]{36})\.csv$/.test(p)))throw new HttpError(400,'Referencia de archivo inválida.');
 const job={id:randomUUID(),state:'running' as const,startedAt:new Date().toISOString()};await writeJob(db,job);
 const dispatched=await fetch(new URL('/.netlify/functions/catalog-background',request.url),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id,paths,confirmDrop:b.confirmDrop})});
 if(!dispatched.ok){await writeJob(db,{...job,state:'failed',error:'No se pudo iniciar la importación.'});throw new HttpError(503,'No se pudo iniciar la importación.');}
 return Response.json({job},{status:202});
 }catch(e){return failure(e);}}
