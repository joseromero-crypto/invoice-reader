import {cityRank,citySlug,type MvFile,type MvRow} from './catalog.ts';
// What the database holds now (read_mv_state). `bc` is that city's own barcode text.
export type MvStoredProduct={id?:string;sku:string;name:string;base_city:string;barcode:string|null;image_url:string|null;full_res_image_url:string|null;calii_unit:string|null;marca:string|null;description:string|null;main_category:string|null;temp:string|null;raw:Record<string,unknown>};
export type MvStoredCity={sku:string;city:string;name:string;bc:string|null;import_id?:string};
export type MvState={version:string|null;products:MvStoredProduct[];cities:MvStoredCity[];imports?:{id:string;uploaded_at:string}[]};
export type MvConflict={barcode:string;skus:{sku:string;cities:string[]}[]};
export type MvReport={cities:Record<string,{rows:number;exclusives:number;missingVsMonterrey:number;replaced:boolean}>;nameVariants:{sku:string;names:Record<string,string>}[];barcodeConflicts:MvConflict[];retired:string[];added:number;updated:number;unchanged:number;warnings:string[]};
const DROP_LIMIT=0.9;
// Same rules as the static apps (cleanBC + bcKey in sorting-hub/index.html), so their lookups hit these keys.
function cleanBC(raw:string){let s=raw.trim();if(!s)return '';if(/[eE][+\-]?\d+$/.test(s)){const n=Number(s);if(!isNaN(n)&&isFinite(n))s=n.toFixed(0);}s=s.replace(/\.0+$/,'');if(s.includes('.'))s=s.split('.')[0];return s;}
const bcKey=(bc:string)=>bc.replace(/^0+/,'')||bc;
export const barcodeKeys=(text:string|null|undefined)=>[...new Set(String(text??'').split(/[,;/\s]+/).map(cleanBC).filter(Boolean).map(bcKey))];
export const normName=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const byCity=(a:{city:string},b:{city:string})=>cityRank(a.city)-cityRank(b.city)||a.city.localeCompare(b.city);
const stable=(v:unknown):string=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
// barcode key → sku → cities. A city with no barcode of its own uses the product's.
function barcodeIndex(rows:Iterable<{sku:string;city:string;bc:string|null}>,fallback:(sku:string)=>string|null){
 const index=new Map<string,Map<string,string[]>>();
 for(const row of rows)for(const key of barcodeKeys(row.bc||fallback(row.sku))){
  const skus=index.get(key)??new Map<string,string[]>();index.set(key,skus);
  skus.set(row.sku,[...(skus.get(row.sku)??[]),row.city].sort((a,b)=>byCity({city:a},{city:b})));}
 return index;
}
// The SKU of the best-ranked city wins a shared barcode; the others are the conflict.
const ranked=(skus:Map<string,string[]>)=>[...skus].map(([sku,cities])=>({sku,cities})).sort((a,b)=>byCity({city:a.cities[0]},{city:b.cities[0]})||a.sku.localeCompare(b.sku));
const asStored=(row:MvRow,city:string):MvStoredProduct=>({sku:row.sku,name:row.name,base_city:city,barcode:row.barcode,image_url:row.productRaw['Image URL']??null,full_res_image_url:row.productRaw['Full Res. Image URL']??null,calii_unit:row.productRaw['Calii Unit']??null,marca:row.productRaw.Marca??null,description:row.productRaw.Description??null,main_category:row.productRaw.main_category??null,temp:row.productRaw['Temp (°C)']??null,raw:row.productRaw});
// Decide everything an upload changes, without writing. Only the uploaded cities are replaced; the others keep
// their rows and only count towards each product's base row. A product retires when no city has it any more.
export function planImport(files:MvFile[],state:MvState,options:{confirmDrop?:boolean;now?:string}={}){
 const errors=files.flatMap(f=>f.errors),warnings=files.flatMap(f=>f.warnings);
 if(!files.length)errors.push('Elige al menos un archivo.');
 const seen=new Set<string>();
 for(const f of files){if(!f.city){if(!f.errors.length)errors.push(`No se detectó la ciudad de ${f.fileName||'un archivo'}.`);continue;}if(seen.has(f.city))errors.push(`Hay dos archivos de ${f.city}: sube uno por ciudad.`);seen.add(f.city);}
 const previous=new Map<string,number>();for(const c of state.cities)previous.set(c.city,(previous.get(c.city)??0)+1);
 const drops=files.flatMap(f=>{const before=previous.get(f.city??'')??0;return f.city&&!f.errors.length&&f.rows.length<before*DROP_LIMIT?[{city:f.city,before,after:f.rows.length}]:[];});
 if(!options.confirmDrop)for(const d of drops)errors.push(`${d.city} bajó de ${d.before.toLocaleString('es-MX')} a ${d.after.toLocaleString('es-MX')} filas (más de 10%). Si es correcto, marca "Sí, es correcto" y sube otra vez.`);
 if(errors.length)return {errors,drops,warnings,cities:[] as string[],products:[] as MvStoredProduct[],rows:[] as {city:string;row:MvRow}[],report:null};
 const uploaded=new Set(files.map(f=>f.city!));
 const oldProducts=new Map(state.products.map(p=>[p.sku,p]));
 const merged=new Map<string,{city:string;name:string;bc:string|null;row?:MvRow}[]>();
 const add=(sku:string,entry:{city:string;name:string;bc:string|null;row?:MvRow})=>{const list=merged.get(sku);if(list)list.push(entry);else merged.set(sku,[entry]);};
 for(const c of state.cities)if(!uploaded.has(c.city))add(c.sku,{city:c.city,name:c.name,bc:c.bc});
 for(const f of files)for(const row of f.rows)add(row.sku,{city:f.city!,name:row.name,bc:row.barcode,row});
 const products:MvStoredProduct[]=[],retired:string[]=[];let added=0,updated=0,unchanged=0;
 for(const old of state.products)if(!merged.has(old.sku)&&!old.raw.retired_at){products.push({...old,raw:{...old.raw,retired_at:options.now??new Date().toISOString()}});retired.push(old.sku);}
 for(const [sku,entries] of merged){
  entries.sort(byCity);const base=entries[0],old=oldProducts.get(sku);
  // Product-level columns only arrive in uploaded files, so a base city outside the upload keeps what was stored.
  const next=base.row?asStored(base.row,base.city):{...old!,name:base.name,base_city:base.city,barcode:base.bc};
  if(!old)added++;else if(stable({...old,id:undefined})===stable({...next,id:undefined})){unchanged++;continue;}else updated++;
  products.push(next);
 }
 const inMonterrey=new Set([...merged].filter(([,e])=>e.some(x=>x.city==='Monterrey')).map(([sku])=>sku));
 const cities:MvReport['cities']={};
 for(const [sku,entries] of merged)for(const e of entries){const c=cities[e.city]??={rows:0,exclusives:0,missingVsMonterrey:0,replaced:uploaded.has(e.city)};c.rows++;if(inMonterrey.size&&!inMonterrey.has(sku))c.exclusives++;}
 for(const [city,c] of Object.entries(cities))c.missingVsMonterrey=[...inMonterrey].filter(sku=>!merged.get(sku)!.some(e=>e.city===city)).length;
 const nameVariants=[...merged].filter(([,e])=>new Set(e.map(x=>x.name)).size>1).map(([sku,e])=>({sku,names:Object.fromEntries(e.map(x=>[x.city,x.name]))}));
 const baseBarcode=(sku:string)=>merged.get(sku)?.[0].bc??null;
 const barcodeConflicts=[...barcodeIndex([...merged].flatMap(([sku,e])=>e.map(x=>({sku,city:x.city,bc:x.bc}))),baseBarcode)].filter(([,skus])=>skus.size>1).map(([barcode,skus])=>({barcode,skus:ranked(skus)}));
 const report:MvReport={cities,nameVariants,barcodeConflicts,retired,added,updated,unchanged,warnings};
 return {errors,drops,warnings,cities:[...uploaded],products,rows:files.flatMap(f=>f.rows.map(row=>({city:f.city!,row}))),report};
}
// Arguments for the import_mv RPC. The city barcode is stored only when it differs from the product's; the RPC recomputes that.
export const importPayload=(plan:ReturnType<typeof planImport>)=>({p_cities:plan.cities,p_products:plan.products.map(({id:_,...p})=>p),p_rows:plan.rows.map(({city,row})=>({sku:row.sku,city,retool_id:row.retoolId,name:row.name,proveedor:row.proveedor,sku_proveedor:row.skuProveedor,unidad_compra:row.unidadCompra,piezas_por_unidad:row.piezasPorUnidad,deshabilitar_compras:row.deshabilitarCompras,tiers:row.tiers,raw:row.cityRaw}))});
// masterview/latest.json for the static apps: barcode entries are objects, name entries plain strings (what Sorting Hub reads today).
export function buildLatest(state:MvState,hubs:{name:string;city:string|null;active:boolean}[]){
 const products=new Map(state.products.filter(p=>!p.raw.retired_at).map(p=>[p.sku,p]));
 const rows=state.cities.filter(c=>products.has(c.sku)).sort(byCity);
 const sold=new Map<string,string[]>();for(const r of rows)sold.set(r.sku,[...(sold.get(r.sku)??[]),r.city]);
 const entry=(sku:string,c:string[])=>{const p=products.get(sku)!;return {url:p.image_url??null,name:p.name,sku,c};};
 const map:Record<string,unknown>={},alt:Record<string,unknown[]>={};
 for(const [key,skus] of barcodeIndex(rows,sku=>products.get(sku)!.barcode)){
  const [first,...others]=ranked(skus);map[key]=entry(first.sku,sold.get(first.sku)!);
  // alt only answers for cities the map entry doesn't cover; a repeat inside one city stays a conflict in the report.
  const other=others.map(o=>entry(o.sku,o.cities.filter(c=>!first.cities.includes(c)))).filter(o=>o.c.length);
  if(other.length)alt[key]=other;
 }
 // Rows are in city order, so on a name clash the Monterrey name is the one that stays.
 for(const r of rows){const key=normName(r.name),url=products.get(r.sku)!.image_url;if(key&&url&&!(key in map))map[key]=url;}
 const uploadedAt=new Map((state.imports??[]).map(i=>[i.id,i.uploaded_at])),cityUpdatedAt:Record<string,string>={};
 for(const r of rows){const at=uploadedAt.get(r.import_id??'');if(at&&(!cityUpdatedAt[r.city]||at>cityUpdatedAt[r.city]))cityUpdatedAt[r.city]=at;}
 const updatedAt=(state.imports??[]).find(i=>i.id===state.version)?.uploaded_at??null;
 return {updatedAt,version:state.version,count:products.size,cities:[...new Set(rows.map(r=>r.city))],cityUpdatedAt,hubCities:Object.fromEntries(hubs.filter(h=>h.active&&h.city).map(h=>[citySlug(h.name),h.city])),map,alt};
}
