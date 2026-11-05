import {it,expect,vi,beforeEach} from 'vitest';
const state=vi.hoisted(()=>({role:'admin',db:null as any}));
vi.mock('../server/auth',async original=>({...(await original<any>()),authorize:async()=>({db:state.db,userId:'user',orgId:'org',role:state.role,token:'t'})}));
import catalog from '../netlify/functions/catalog';
import background from '../netlify/functions/catalog-background';
import {publishMasterview,runJob,type MvJob} from '../server/masterview';
const header='id,sku,Item,city,Código de Barras,Image URL,Proveedor';
function fakeDB({csv=`${header}\n1,A,Uno,Monterrey,111,https://i/a,P`,fail=''}={}){
 const writes:string[]=[],removed:string[]=[],rpc:any[]=[],objects=new Map<string,string>([['masterview/monterrey/incoming-x.csv',csv]]);
 const db:any={writes,removed,rpc:async(name:string,args:any)=>{rpc.push(name);
  if(name===fail)return {data:null,error:{message:'boom'}};
  if(name==='read_mv_state')return {data:{version:null,products:rpc.includes('import_mv')?[{sku:'A',name:'Uno',barcode:'111',image_url:'https://i/a',raw:{}}]:[],cities:rpc.includes('import_mv')?[{sku:'A',city:'Monterrey',name:'Uno',bc:'111',import_id:'v'}]:[],imports:[{id:'v',uploaded_at:'2026-11-05T00:00:00Z'}],...(rpc.includes('import_mv')?{version:'v'}:{})},error:null};
  if(name==='import_mv')return {data:{version:'v',uploadedAt:'2026-11-05T00:00:00Z'},error:null};
  if(name==='mv_city_status')return {data:[],error:null};return {data:null,error:null};},
 from:()=>{const chain:any={};for(const m of ['select','order','limit'])chain[m]=()=>chain;chain.maybeSingle=async()=>({data:null,error:null});chain.then=(y:any,n:any)=>Promise.resolve({data:[{name:'MH Contry',city:'Monterrey',active:true}],error:null}).then(y,n);return chain;},
 storage:{from:(bucket:string)=>({
  download:async(path:string)=>objects.has(path)?{data:new Blob([objects.get(path)!]),error:null}:{data:null,error:{message:'not found'}},
  upload:async(path:string,body:any)=>{writes.push(`${bucket}/${path}`);objects.set(path,body instanceof Blob?await body.text():new TextDecoder().decode(body));return {data:{},error:null};},
  remove:async(paths:string[])=>{removed.push(...paths);return {data:[],error:null};},
  createSignedUploadUrl:async(path:string)=>({data:{token:`token-${path}`},error:null})})}};
 return db;
}
const post=(body:unknown)=>new Request('http://local/api/catalog',{method:'POST',body:JSON.stringify(body)});
const job:MvJob={id:'11111111-1111-4111-8111-111111111111',state:'running',startedAt:new Date().toISOString()};
const lastJob=async(db:any)=>JSON.parse(await (await db.storage.from('catalogs').download('masterview/job.json')).data.text());
beforeEach(()=>{state.role='admin';state.db=fakeDB();});
it('refuses every action to a receiver, on both functions',async()=>{
 state.role='receiver';
 for(const action of ['status','prepare','start','reread'])expect((await catalog(post({action,cities:['CDMX'],paths:[],confirmDrop:false}))).status).toBe(403);
 expect((await background(post({jobId:job.id,paths:['masterview/monterrey/incoming-x.csv'],confirmDrop:false}))).status).toBe(403);
 expect(state.db.writes).toEqual([]);
});
it('accepts only paths under catalogs/masterview',async()=>{
 const response=await catalog(post({action:'start',paths:['../org/secret.csv'],confirmDrop:false}));
 expect(response.status).toBe(400);expect(state.db.writes).toEqual([]);
});
it('imports, moves the file to latest.csv, then publishes latest.json before version.txt',async()=>{
 await runJob(state.db,'user',job,{paths:['masterview/monterrey/incoming-x.csv']});
 expect(state.db.writes.filter((w:string)=>!w.endsWith('job.json'))).toEqual(['catalogs/masterview/monterrey/latest.csv','masterview/latest.json','masterview/version.txt']);
 expect(state.db.removed).toEqual(['masterview/monterrey/incoming-x.csv']);
 expect(await lastJob(state.db)).toMatchObject({state:'done',version:'v',published:true});
});
it('a rejected file writes nothing but the job result, and latest.csv stays',async()=>{
 state.db=fakeDB({csv:`id,sku,Item,city,Proveedor\n1,A,Uno,CDMX,P`});
 await runJob(state.db,'user',job,{paths:['masterview/monterrey/incoming-x.csv']});
 expect(state.db.writes).toEqual(['catalogs/masterview/job.json']);
 const result=await lastJob(state.db);expect(result.state).toBe('failed');expect(result.error).toMatch(/El archivo de CDMX: Falta Image URL \/ Código de Barras/);
});
it('a failed database write publishes nothing',async()=>{
 state.db=fakeDB({fail:'import_mv'});
 await runJob(state.db,'user',job,{paths:['masterview/monterrey/incoming-x.csv']});
 expect(state.db.writes).toEqual(['catalogs/masterview/job.json']);expect((await lastJob(state.db)).state).toBe('failed');
});
it('never publishes an empty Masterview',async()=>{await expect(publishMasterview(state.db)).rejects.toThrow(/no tiene importaciones/);expect(state.db.writes).toEqual([]);});
