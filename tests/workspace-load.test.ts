import {describe,it,expect} from 'vitest';
import {inTurns,loadWorkspace,retried} from '../server/workspace';
function fakeDB(){
 const rpc:string[]=[];
 const data:Record<string,any>={mv_imports:{id:'11111111-1111-1111-1111-111111111111'},receiving_sessions:{hub_id:'hub',status:'open'},documents:[],review_events:[]};
 const db:any={rpc:async(name:string)=>{rpc.push(name);return {data:[{city:'Monterrey',rows:1}],error:null};},
 from:(t:string)=>{const chain:any={};for(const m of ['select','eq','order','limit'])chain[m]=()=>chain;chain.range=async()=>({data:[{sku:'S1',city:'Monterrey',name:'Producto 1',barcode:null,proveedor:'X',sku_proveedor:'1',unidad_compra:'Caja',piezas_por_unidad:'12',mv_products:{id:'p1',base_city:'Monterrey',calii_unit:'pz',barcode:null,retired:null}}],error:null});chain.single=chain.maybeSingle=async()=>({data:data[t],error:null});chain.then=(y:any,n:any)=>Promise.resolve({data:data[t],error:null}).then(y,n);return chain;}};
 return {db,rpc};
}
it('sends the catalog on first load and skips the catalog read on polls while the version is unchanged',async()=>{
 const {db,rpc}=fakeDB();
 const first=await loadWorkspace(db,'org','s',null);
 expect(first.catalogUnchanged).toBe(false);expect(first.products[0]).toMatchObject({id:'p1',purchaseUnit:'Caja',perPurchaseUnit:12});expect(rpc).toEqual(['mv_city_status']);
 const poll=await loadWorkspace(db,'org','s',first.catalogVersion);
 expect(poll.catalogUnchanged).toBe(true);expect(poll.products).toEqual([]);expect(rpc).toHaveLength(1);
 const changed=await loadWorkspace(db,'org','s','22222222-2222-2222-2222-222222222222');
 expect(changed.catalogUnchanged).toBe(false);expect(rpc).toHaveLength(2);
});

describe('catalog reads on the shared project',()=>{
 it('reads pages a few at a time, in order',async()=>{
  let running=0,most=0;
  const pages=await inTurns(14,async i=>{running++;most=Math.max(most,running);await new Promise(r=>setTimeout(r,1));running--;return i;});
  expect(pages).toEqual([...Array(14).keys()]);expect(most).toBe(3);
 });
 it('tries again after a statement timeout, and gives up after three tries',async()=>{
  let calls=0;const wait=async()=>{};
  await expect(retried(async()=>{if(++calls<3)throw Error('canceling statement due to statement timeout');return 'ok';},wait)).resolves.toBe('ok');
  calls=0;await expect(retried(async()=>{calls++;throw Error('upstream request timeout');},wait)).rejects.toThrow('upstream');expect(calls).toBe(3);
 });
 it('does not retry other errors',async()=>{
  let calls=0;await expect(retried(async()=>{calls++;throw Error('permission denied');},async()=>{})).rejects.toThrow('permission');expect(calls).toBe(1);
 });
});
