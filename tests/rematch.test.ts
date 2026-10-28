import {it,expect} from 'vitest';
import {rematchDocument} from '../server/rematch';
it('refreshes saved reads without AI, preserving reviewed and concurrently edited rows',async()=>{
 const source=(n:number)=>({sourcePage:1,sourceRow:n,supplierSku:'1',barcode:null,description:'Example product',quantity:3,unit:'PZ',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:'Example product PZ 3',flags:['handwritten_check_mark']});
 const raw={supplier:'Example supplier',reference:'TEST',date:null,currency:null,printedPage:2,printedPageCount:3,printedTotal:null,warnings:[],rows:[1,2,3,4].map(source)};
 const originals=[{id:'a',source_row:1,revision:0,review:{confirmed:false}},{id:'b',source_row:2,revision:1,review:{confirmed:false,corrections:{description:'Receiver edit'}}},{id:'c',source_row:3,revision:0,review:{confirmed:true}},{id:'d',source_row:4,revision:0,review:{confirmed:false}}];
 const state=structuredClone(originals),audit:any[]=[];let raced=false;
 const db:any={rpc:async()=>({data:[{id:'internal',external_id:'001',sku:'EXAMPLE',name:'Example product',supplier:'Example supplier',supplier_sku:'1',barcode:null,unit:'pz'}],error:null}),from:(table:string)=>{
 let update:any,filters:Record<string,any>={};
 const result=()=>{
 if(table==='extraction_jobs')return {data:{status:'complete',raw_result:raw},error:null};
 if(table==='supplier_mappings'||table==='quantity_conversions')return {data:[],error:null};
 if(table==='invoice_rows'&&!update)return {data:structuredClone(originals),error:null};
 if(table==='invoice_rows'){
 if(filters.id==='d'&&!raced){state[3].revision=1;state[3].review={confirmed:false,corrections:{description:'Concurrent receiver edit'}} as any;raced=true;}
 const row=state.find(r=>r.id===filters.id&&r.revision===filters.revision);if(row)Object.assign(row,update);return {data:row?[{id:row.id}]:[],error:null};
 }
 return {data:[],error:null};
 };
 const chain:any={select:()=>chain,eq:(key:string,value:any)=>{filters[key]=value;return chain;},update:(value:any)=>{update=value;return chain;},insert:(value:any)=>{audit.push(value);return chain;},single:async()=>result(),then:(resolve:any,reject:any)=>Promise.resolve(result()).then(resolve,reject)};return chain;
 }};
 const result=await rematchDocument(db,'org','actor',{id:'doc',supplier:'Example supplier',metadata_revision:0,warnings:['Documento incompleto: 1 de 3 páginas.']});
 expect(result).toEqual({updated:1,preserved:3});expect((state[0].review as any).confirmedQuantity).toBe(3);expect(state[0].revision).toBe(1);expect(state[1]).toEqual(originals[1]);expect(state[2]).toEqual(originals[2]);expect((state[3].review as any).corrections.description).toBe('Concurrent receiver edit');expect(audit).toHaveLength(1);expect(audit[0].row_id).toBe('a');
});
