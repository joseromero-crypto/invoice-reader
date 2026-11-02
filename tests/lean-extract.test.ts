import {it,expect,vi,beforeEach} from 'vitest';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
vi.mock('../server/auth',()=>({authorize:async()=>({db:state.db,orgId:'org',userId:'user'}),check:(r:any)=>{if(r.error)throw r.error;return r.data;},HttpError:class extends Error{constructor(public status:number,message:string){super(message);}}}));
vi.mock('../server/hubs',()=>({requireHub:async()=>{}}));
const state=vi.hoisted(()=>({db:null as any}));
import {extractJob} from '../server/extract';
import {rematchDocument} from '../server/rematch';
const products=[
 {id:'u-topo',external_id:'topo',sku:'TOPO600',name:'Agua mineral Topo Chico 600ml',supplier:'Arca Continental',supplier_sku:'1152',barcode:null,unit:'pz',raw:{id:'topo',Item:'Agua mineral Topo Chico 600ml',sku:'TOPO600',Proveedor:'Arca Continental','SKU Proveedor':'1152','Unidad de compra':'Caja','Peso neto o piezas (por unidad de compra)':'12'}},
 {id:'u-coca',external_id:'coca',sku:'COCA25',name:'Refresco Coca Cola 2.5L',supplier:'Arca Continental',supplier_sku:'2574',barcode:null,unit:'pz',raw:{id:'coca',Item:'Refresco Coca Cola 2.5L',sku:'COCA25',Proveedor:'Arca Continental','SKU Proveedor':'2574','Unidad de compra':'Caja','Peso neto o piezas (por unidad de compra)':'8'}},
 {id:'u-fanta',external_id:'fanta',sku:'FANTA',name:'Refresco Fanta naranja 600ml',supplier:'Arca Continental',supplier_sku:'',barcode:null,unit:'pz',raw:{id:'fanta',Item:'Refresco Fanta naranja 600ml',sku:'FANTA',Proveedor:'Arca Continental','Unidad de compra':'Caja','Peso neto o piezas (por unidad de compra)':'24'}},
];
const transcription={supplier:'ARCA CONTINENTAL SAB',documentRef:'F-77',date:'28/10/2026',quantityColumns:['CAJAS','PIEZAS'],printedTotals:[{label:'TOTAL PIEZAS',value:'84'}],rows:[
 {photo:1,codes:[{header:'DESCRIPCION',value:'1152'},{header:'CVEPROD',value:'50202310'}],description:'T CH AGUA MINERAL 600 ML',quantities:['5','60'],unit:null,mark:'check',note:null},
 {photo:1,codes:[{header:'DESCRIPCION',value:'2574'}],description:'COCA COLA 2.5L',quantities:['3','24'],unit:null,mark:'check',note:null},
 {photo:1,codes:[{header:'DESCRIPCION',value:'9999'}],description:'FANTA NARANJA 600ML',quantities:[null,null],unit:null,mark:'cross',note:null}]};
let photo:Buffer;
function fakeDB({claim=true,mappings=[] as any[],job:jobOverride={} as any}={}){
 const calls:any[]=[],updates:any[]=[];
 const job:any={id:'job',document_id:'doc',requested_by:'user',status:'queued',claim_token:'claim',...jobOverride};
 const db:any={calls,updates,storage:{from:()=>({download:async()=>({data:new Blob([new Uint8Array(photo)]),error:null})})},rpc:async(name:string,args:any)=>{calls.push([name,args]);
  if(name==='claim_extraction')return {data:claim?{...job,status:'processing'}:null,error:null};
  if(name==='read_catalog_snapshot')return {data:products,error:null};
  return {data:null,error:null};},
 from:(table:string)=>{let mutation:any=null;const chain:any={};for(const m of ['select','eq','gt','neq','order','in','limit'])chain[m]=()=>chain;
  chain.update=(d:any)=>{mutation=d;updates.push([table,d]);return chain;};chain.insert=(d:any)=>{updates.push([table,d]);return chain;};
  const resolve=()=>{if(mutation)return {data:[{id:'x'}],error:null};
   const data=table==='extraction_jobs'?job:table==='documents'?(calls.some(c=>c[0]==='claim_extraction')?[]:{id:'doc',session_id:'session'}):table==='receiving_sessions'?{hub_id:'hub'}:table==='source_pages'?[{page_number:1,object_path:'org/doc/p.jpg',content_hash:createHash('sha256').update(photo).digest('hex')}]:table==='supplier_mappings'?mappings:table==='invoice_rows'?[]:null;
   return {data,error:null};};
  chain.single=chain.maybeSingle=async()=>resolve();chain.then=(y:any,n:any)=>Promise.resolve(resolve()).then(y,n);return chain;}};
 return db;
}
const fetchMock=vi.fn();
beforeEach(async()=>{
 photo=photo??await sharp({create:{width:3000,height:1200,channels:3,background:'#fff'}}).jpeg().toBuffer();
 vi.stubEnv('ANTHROPIC_API_KEY','test');vi.stubEnv('ANTHROPIC_MODEL','claude-sonnet-5-5');
 fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({stop_reason:'end_turn',usage:{input_tokens:5000,output_tokens:1000},content:[{type:'text',text:JSON.stringify(transcription)}]}),{status:200}));
 vi.stubGlobal('fetch',fetchMock);
});
it('reads all photos in one call, downscales them, matches against products.raw and writes one row per proposal',async()=>{
 state.db=fakeDB();await extractJob(new Request('http://local'),'job');
 expect(fetchMock).toHaveBeenCalledTimes(1);
 const body=JSON.parse(fetchMock.mock.calls[0][1].body),image=body.messages[0].content.find((c:any)=>c.type==='image');
 const meta=await sharp(Buffer.from(image.source.data,'base64')).metadata();expect(meta.width).toBe(2576);expect(meta.format).toBe('jpeg');
 const finish=state.db.calls.find((c:any)=>c[0]==='finish_extraction')[1];
 expect(finish.p_raw).toMatchObject({supplier:'Arca Continental',reference:'F-77',date:'2026-10-28',warnings:[],transcription});
 expect(finish.p_cost).toBeCloseTo(0.02);expect(finish.p_model).toBe('claude-sonnet-5-5');
 const [topo,coca,fanta]=finish.p_rows;
 expect(topo).toMatchObject({sourceRow:1,status:'ok',flags:[],proposedQuantity:60,product:{id:'topo',sku:'TOPO600',purchaseUnit:'Caja',perPurchaseUnit:12},raw:transcription.rows[0],mappingSupplier:'Arca Continental',columns:['CAJAS','PIEZAS']});
 expect(coca).toMatchObject({status:'ok',proposedQuantity:24});
 expect(fanta.status).toBe('excluded');expect(fanta.reasons[0]).toBe('tachado en la factura');
 expect(state.db.calls.map((c:any)=>c[0])).not.toContain('reserve_document_call');
});
it('uses a saved supplier mapping for a code the catalog does not know',async()=>{
 const t={...transcription,printedTotals:[],rows:[{...transcription.rows[2],mark:'check',quantities:['1','24']}]};
 fetchMock.mockResolvedValue(new Response(JSON.stringify({stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1},content:[{type:'text',text:JSON.stringify(t)}]})));
 state.db=fakeDB({mappings:[{supplier:'Arca Continental',supplier_sku:'9999',product_id:'u-fanta'}]});await extractJob(new Request('http://local'),'job');
 const row=state.db.calls.find((c:any)=>c[0]==='finish_extraction')[1].p_rows[0];expect(row).toMatchObject({status:'ok',product:{id:'fanta'},proposedQuantity:24});
});
it('does nothing when the job is already claimed, and records a failed read with its cost',async()=>{
 state.db=fakeDB({claim:false});await extractJob(new Request('http://local'),'job');expect(fetchMock).not.toHaveBeenCalled();
 fetchMock.mockResolvedValue(new Response(JSON.stringify({stop_reason:'max_tokens',usage:{input_tokens:1000,output_tokens:8000},content:[{type:'text',text:'{"rows":['}]})));
 state.db=fakeDB();await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow(/No se pudo leer/);
 const failed=state.db.updates.find((u:any)=>u[0]==='extraction_jobs'&&u[1].status==='failed')[1];expect(failed.estimated_cost_usd).toBeCloseTo(0.082);expect(state.db.calls.map((c:any)=>c[0])).not.toContain('finish_extraction');
});
it('rematches a saved transcription for free, preserving confirmed rows',async()=>{
 const db=fakeDB({job:{status:'complete',raw_result:{transcription}}});const original=db.from;
 const rows=[{id:'a',source_row:1,revision:0,review:{confirmed:false}},{id:'b',source_row:2,revision:0,review:{confirmed:true}}];
 db.from=(table:string)=>{const chain=original(table);if(table!=='invoice_rows')return chain;let update=false;const u=chain.update;chain.update=(d:any)=>{update=true;return u(d);};chain.then=(y:any,n:any)=>Promise.resolve({data:update?[{id:'a'}]:rows,error:null}).then(y,n);return chain;};
 expect(await rematchDocument(db,'org','user',{id:'doc'})).toEqual({updated:1,preserved:1});
 expect(fetchMock).not.toHaveBeenCalled();
 const review=db.updates.find((u:any)=>u[0]==='invoice_rows')[1].review;expect(review).toMatchObject({id:'a',status:'ok',product:{id:'topo'},proposedQuantity:60});expect(review.raw).toBeUndefined();
});
it('tells the receiver to capture in Retool and contact José when the Anthropic account has no credit',async()=>{
 fetchMock.mockResolvedValue(new Response(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'}}),{status:400}));
 state.db=fakeDB();await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow(/contactar a José/);
 const failed=state.db.updates.find((u:any)=>u[0]==='extraction_jobs'&&u[1].status==='failed')[1];
 expect(failed.error).toBe('Error de lectura, favor de capturar directo en Retool y contactar a José para cargar créditos a la aplicación.');
 fetchMock.mockResolvedValue(new Response(JSON.stringify({type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}}),{status:401}));
 state.db=fakeDB();await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow(/contactar a José/);
 fetchMock.mockResolvedValue(new Response(JSON.stringify({type:'error',error:{type:'overloaded_error',message:'Overloaded'}}),{status:529}));
 state.db=fakeDB();await expect(extractJob(new Request('http://local'),'job')).rejects.toThrow(/saturado/);
});
