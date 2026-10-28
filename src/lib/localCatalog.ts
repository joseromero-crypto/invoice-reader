import type {Product} from '../../shared/domain';
import {mergeCatalog} from '../../shared/catalog';
export type CatalogState={version:string|null;nameColumn:string;sourceName:string;updatedAt:string|null;count:number;products?:Product[];canImport?:boolean;local?:boolean};
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('calii-masterview-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('catalog');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function readLocalCatalog():Promise<CatalogState|null>{const database=await db();try{return await new Promise((resolve,reject)=>{const tx=database.transaction('catalog');const request=tx.objectStore('catalog').get('current');request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});}finally{database.close();}}
export async function applyLocalCatalog(incoming:Product[],sourceName:string,nameColumn:string,expectedVersion:string|null,initial:Product[]=[]){
 const database=await db();try{return await new Promise<CatalogState&{added:number;updated:number;unchanged:number}>((resolve,reject)=>{
 const tx=database.transaction('catalog','readwrite'),store=tx.objectStore('catalog');let result:CatalogState&{added:number;updated:number;unchanged:number};
 const request=store.get('current');request.onsuccess=()=>{const old=request.result as CatalogState|undefined;if((old?.version??null)!==expectedVersion){tx.abort();reject(Error('Otra pestaña actualizó el catálogo. Recarga la vista previa.'));return;}const merged=mergeCatalog(old?.products??initial,incoming);result={...merged,version:crypto.randomUUID(),nameColumn,sourceName,updatedAt:new Date().toISOString(),count:merged.products.length,local:true,canImport:true};store.put(result,'current');};
 tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('No se guardó el catálogo.'));
 });}finally{database.close();}
}
