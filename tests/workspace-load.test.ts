import {it,expect} from 'vitest';
import {loadWorkspace} from '../server/workspace';
function fakeDB(){
 const rpc:string[]=[];
 const data:Record<string,any>={mv_imports:{id:'11111111-1111-1111-1111-111111111111'},receiving_sessions:{hub_id:'hub',status:'open'},documents:[],review_events:[]};
 const db:any={rpc:async(name:string)=>{rpc.push(name);return {data:[{id:'p1',sku:'S1',name:'Producto 1',barcode:null,calii_unit:'pz',raw:{},city_row:{name:'Producto 1',barcode:null,raw:{Proveedor:'X','SKU Proveedor':'1','Unidad de compra':'Caja','Peso neto o piezas (por unidad de compra)':'12'}}}],error:null};},
 from:(t:string)=>{const chain:any={};for(const m of ['select','eq','order','limit'])chain[m]=()=>chain;chain.single=chain.maybeSingle=async()=>({data:data[t],error:null});chain.then=(y:any,n:any)=>Promise.resolve({data:data[t],error:null}).then(y,n);return chain;}};
 return {db,rpc};
}
it('sends the catalog on first load and skips the catalog read on polls while the version is unchanged',async()=>{
 const {db,rpc}=fakeDB();
 const first=await loadWorkspace(db,'org','s',null);
 expect(first.catalogUnchanged).toBe(false);expect(first.products[0]).toMatchObject({id:'p1',purchaseUnit:'Caja',perPurchaseUnit:12});expect(rpc).toEqual(['read_mv_catalog']);
 const poll=await loadWorkspace(db,'org','s',first.catalogVersion);
 expect(poll.catalogUnchanged).toBe(true);expect(poll.products).toEqual([]);expect(rpc).toHaveLength(1);
 const changed=await loadWorkspace(db,'org','s','22222222-2222-2222-2222-222222222222');
 expect(changed.catalogUnchanged).toBe(false);expect(rpc).toHaveLength(2);
});
