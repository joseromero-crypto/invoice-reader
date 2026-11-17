import {z} from 'zod';
import {failure,HttpError} from '../../server/auth';
import {corsHeaders,listHub,readSession,start,submit} from '../../server/recepcion';
import {limits} from '../../server/config';
// For mh-recibo (no user sign-in): start → PUT each photo to its signed URL → submit → poll read. See CLAUDE.md.
const sessionId=z.string().trim().min(10).max(200).regex(/^[a-z0-9-]+__[^\s]+$/);
const Input=z.discriminatedUnion('action',[
 z.object({action:z.literal('start'),sessionId,photoCount:z.number().int().min(1).max(8)}),
 z.object({action:z.literal('submit'),sessionId,documentId:z.string().uuid()}),
 z.object({action:z.literal('read'),sessionId}),
 z.object({action:z.literal('list'),hubSlug:z.string().trim().min(1).max(80),since:z.string().datetime({offset:true}).nullable().optional()})]);
export default async function handler(request:Request){
 const cors=corsHeaders(request.headers.get('origin'));
 if(!cors)return new Response(null,{status:403});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const answer=(r:Response)=>{for(const [k,v] of Object.entries(cors))r.headers.set(k,v);return r;};
 try{
  if(request.method!=='POST')throw new HttpError(405,'POST required');
  const parsed=Input.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new HttpError(400,'Invalid request');const b=parsed.data;
  if(b.action==='start'){if(b.photoCount>limits().maxPages)throw new HttpError(400,'Demasiadas fotos.');return answer(Response.json(await start(b.sessionId,b.photoCount)));}
  if(b.action==='submit')return answer(Response.json(await submit(request,b.sessionId,b.documentId),{status:202}));
  if(b.action==='read')return answer(Response.json(await readSession(b.sessionId)));
  return answer(Response.json(await listHub(b.hubSlug,b.since??null)));
 }catch(e){return answer(failure(e));}
}
