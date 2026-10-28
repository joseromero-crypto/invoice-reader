import {z} from 'zod';
import {createHash} from 'node:crypto';
import {authorize,check,failure,HttpError} from '../../server/auth';
import {parseCatalog} from '../../shared/catalog';
const Input=z.discriminatedUnion('action',[
 z.object({action:z.literal('status')}),
 z.object({action:z.literal('apply'),objectPath:z.string().max(200),sourceName:z.string().min(1).max(200),nameColumn:z.string().min(1).max(200),expectedVersion:z.string().uuid().nullable()})]);
export default async function handler(request:Request){try{
 if(request.method!=='POST')throw new HttpError(405,'POST required');
 const {db,userId,orgId,role}=await authorize(request);const parsed=Input.safeParse(await request.json());if(!parsed.success)throw new HttpError(400,'Solicitud de catálogo inválida.');const b=parsed.data;
 if(b.action==='status'){
 const org=check(await db.from('organizations').select('catalog_revision').eq('id',orgId).single())!;
 const run=org.catalog_revision?check(await db.from('catalog_imports').select('report,created_at').eq('org_id',orgId).eq('id',org.catalog_revision).single()):null;
 const {count,error}=await db.from('products').select('id',{head:true,count:'exact'}).eq('org_id',orgId);if(error)throw error;
 return Response.json({version:org.catalog_revision,count:count??0,orgId,canImport:role==='admin',nameColumn:run?.report?.nameColumn??'Item',sourceName:run?.report?.sourceName??'Catálogo de la organización',updatedAt:run?.created_at??null});
 }
 if(role!=='admin')throw new HttpError(403,'Se requiere acceso de administrador para actualizar el catálogo compartido.');
 if(!new RegExp(`^${orgId}/[a-f0-9-]{36}\\.csv$`).test(b.objectPath))throw new HttpError(400,'Referencia de archivo inválida.');
 const blob=check(await db.storage.from('catalogs').download(b.objectPath))!;if(blob.size>15000000)throw new HttpError(400,'CSV demasiado grande. Máximo 15 MB.');
 let csv:string;try{csv=new TextDecoder('utf-8',{fatal:true}).decode(await blob.arrayBuffer());}catch{throw new HttpError(400,'Exporta el catálogo como CSV UTF-8.');}
 const report=parseCatalog(csv,{nameColumn:b.nameColumn});if(report.errors.length)throw new HttpError(400,report.errors.slice(0,5).join(' '));
 const rawHash=createHash('sha256').update(csv).digest('hex');const hash=createHash('sha256').update(`${rawHash}|${b.nameColumn}`).digest('hex');
 const result=check(await db.rpc('import_masterview',{p_org:orgId,p_actor:userId,p_hash:hash,p_report:{sourceName:b.sourceName,nameColumn:b.nameColumn,objectPath:b.objectPath,rawHash,warnings:report.warnings,count:report.products.length},p_products:report.products,p_expected_revision:b.expectedVersion}));
 return Response.json({...result,nameColumn:b.nameColumn,sourceName:b.sourceName,updatedAt:new Date().toISOString(),canImport:true});
 }catch(e){return failure(e);}}
