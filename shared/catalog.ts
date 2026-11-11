import {parse} from 'csv-parse/browser/esm/sync';
import type {Product,Workspace} from './domain.ts';
import {supplierKey} from './matching.ts';
export type CatalogOptions={nameColumn?:string};
export function parseCatalog(csv:string,options:CatalogOptions={}){
 const errors:string[]=[],warnings:string[]=[];let columns:string[]=[];
 let source:Record<string,string>[]=[];
 try{source=parse(csv,{bom:true,skip_empty_lines:true,relax_column_count:false,max_record_size:1000000,columns:(headers:string[])=>{columns=headers;return headers;}}) as Record<string,string>[];}catch(e){return {products:[] as Product[],errors:[`CSV inválido: ${(e as Error).message}`],warnings,columns,nameColumn:options.nameColumn??'Item'};}
 const nameColumn=options.nameColumn??(columns.includes('Item')?'Item':columns.includes('Description')?'Description':'Item');
 if(new Set(columns).size!==columns.length)errors.push('El archivo contiene encabezados duplicados.');
 for(const required of ['id','sku',nameColumn])if(!columns.includes(required))errors.push(`Falta la columna ${required}.`);
 if(!source.length)errors.push('El archivo no contiene productos.');
 if(source.length>20000)errors.push('Máximo 20,000 productos por archivo.');
 const ids=new Set<string>(),barcodes=new Map<string,string>(),skus=new Map<string,string>();
 const products:Product[]=source.map((r,index)=>{
 const id=r.id?.trim()??'',sku=r.sku?.trim()??'',name=r[nameColumn]??'';
 if(!id||!sku||!name.trim())errors.push(`Fila ${index+2}: faltan id, sku o ${nameColumn}`);
 if(ids.has(id))errors.push(`ID duplicado: ${id}`);ids.add(id);
 const supplier=r.Proveedor?.trim()??'',supplierSku=r['SKU Proveedor']?.trim()||null,barcode=r['Código de Barras']?.trim()||null;
 if(barcode){if(barcodes.has(barcode))warnings.push(`Barcode ambiguo ${barcode}: ${barcodes.get(barcode)}, ${id}`);barcodes.set(barcode,id);}
 if(supplierSku){const key=supplierKey(supplier,supplierSku);if(skus.has(key))warnings.push(`SKU proveedor ambiguo ${key}`);skus.set(key,id);}
 // Display the exact selected export value; raw source fields remain unchanged.
 return {id,sku,name,nameColumn,supplier,supplierSku,barcode,unit:r['Calii Unit']||'desconocida',raw:r};
 });return {products,errors,warnings,columns,nameColumn};
}
// Masterview columns the importer keeps, per product and per city. Everything else (prices, competitors) is dropped.
// lean/match.ts catalogItem() reads id, Item, sku, Proveedor, SKU Proveedor, Código de Barras, Unidad de compra and
// Peso neto o piezas. To add a column: add it here, then "Releer últimos archivos" in the Masterview screen.
export const MV_PRODUCT_COLUMNS=['Image URL','Full Res. Image URL','Item','Description','Marca','Calii Unit','Default Selection Unit','Temp (°C)','main_category','Internal Weight Per Piece (g)','Source Unit','Assembly Category (options are: frutas y verduras, carnes, abarrotes)','Requires exp. date confirmation'] as const;
export const MV_CITY_COLUMNS=['id','city','Item','Código de Barras','Proveedor','SKU Proveedor','Unidad de compra','Peso neto o piezas (por unidad de compra)','Deshabilitar compras','Shelf life min. user (days)','Shelf life min. supplier (days)'] as const;
export const CITY_PRIORITY=['Monterrey','Saltillo','CDMX','Guadalajara'];
const MV_MAX_ROWS=20000;
const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export const canonicalCity=(city:string)=>CITY_PRIORITY.find(c=>fold(c)===fold(city))??city.trim();
export const cityRank=(city:string)=>{const i=CITY_PRIORITY.indexOf(city);return i<0?CITY_PRIORITY.length:i;};
export const citySlug=(city:string)=>fold(city).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export type MvRow={sku:string;retoolId:string;name:string;barcode:string|null;proveedor:string|null;skuProveedor:string|null;unidadCompra:string|null;piezasPorUnidad:number|null;deshabilitarCompras:boolean|null;tiers:string|null;productRaw:Record<string,string>;cityRaw:Record<string,string>};
export type MvFile={fileName:string;city:string|null;rows:MvRow[];errors:string[];warnings:string[]};
const mvValue=(v:unknown)=>{const s=String(v??'').trim();return s==='-'||s==="'-"?'':s;};
const mvPick=(row:Record<string,string>,columns:readonly string[])=>Object.fromEntries(columns.map(c=>[c,mvValue(row[c])]).filter(([,v])=>v));
// One per-city Masterview export. Checks only what one file can tell; planImport() in masterview.ts checks the upload as a whole.
export function parseMasterviewFile(csv:string,fileName=''):MvFile{
 const errors:string[]=[],warnings:string[]=[];let columns:string[]=[],source:Record<string,string>[]=[];
 try{source=parse(csv,{bom:true,skip_empty_lines:true,relax_column_count:false,max_record_size:1000000,columns:(headers:string[])=>{columns=headers;return headers;}}) as Record<string,string>[];}catch(e){return {fileName,city:null,rows:[],errors:[`${fileName||'El archivo'}: CSV inválido: ${(e as Error).message}`],warnings};}
 const found=[...new Set(source.map(r=>canonicalCity(r.city??'')).filter(Boolean))],city=found.length===1?found[0]:null,label=city?`El archivo de ${city}`:fileName?`El archivo ${fileName}`:'El archivo';
 if(new Set(columns).size!==columns.length)errors.push(`${label} tiene encabezados duplicados.`);
 const missing=['Image URL','Código de Barras'].filter(c=>!columns.includes(c));
 if(missing.length)errors.push(`${label}: Falta ${missing.join(' / ')} — ¿es la exportación completa de Masterview?`);
 for(const required of ['id','sku','Item','city','Proveedor'])if(!columns.includes(required))errors.push(`${label} no tiene la columna ${required}.`);
 if(!source.length)errors.push(`${label} no contiene productos.`);
 if(source.length>MV_MAX_ROWS)errors.push(`${label} tiene más de ${MV_MAX_ROWS.toLocaleString('es-MX')} filas.`);
 if(found.length>1)errors.push(`${label} mezcla ciudades (${found.join(', ')}): sube un archivo por ciudad.`);
 if(errors.length)return {fileName,city,rows:[],errors,warnings};
 const seen=new Set<string>(),problems:string[]=[];
 const rows=source.map((r,index):MvRow=>{
  // Item stays exactly as exported: it is the text the receiver copies back to Retool.
  const sku=r.sku?.trim()??'',retoolId=r.id?.trim()??'',name=r.Item??'';
  if(!r.city?.trim())problems.push(`fila ${index+2} sin city`);
  if(!sku)problems.push(`fila ${index+2} sin sku`);else if(seen.has(sku))problems.push(`SKU duplicado ${sku}`);
  if(!retoolId||!name.trim())problems.push(`fila ${index+2} sin id o Item`);
  seen.add(sku);
  // Tiers is kept as printed (1–8, 0, C, F, N…) for inventario-conf, which interprets it. A file without the column gives null.
  const n=parseFloat(mvValue(r['Peso neto o piezas (por unidad de compra)']).replace(',','.')),off=mvValue(r['Deshabilitar compras']).toLowerCase();
  return {sku,retoolId,name,barcode:mvValue(r['Código de Barras'])||null,proveedor:mvValue(r.Proveedor)||null,skuProveedor:mvValue(r['SKU Proveedor'])||null,unidadCompra:mvValue(r['Unidad de compra'])||null,piezasPorUnidad:Number.isFinite(n)?n:null,deshabilitarCompras:off==='true'?true:off==='false'?false:null,tiers:r.Tiers?.trim()||null,productRaw:mvPick(r,MV_PRODUCT_COLUMNS),cityRaw:mvPick(r,MV_CITY_COLUMNS)};
 });
 if(problems.length)errors.push(`${label}: ${problems.slice(0,5).join(', ')}${problems.length>5?` y ${problems.length-5} más`:''}.`);
 if(city&&!CITY_PRIORITY.includes(city))warnings.push(`Ciudad desconocida: ${city}. Se importa tal cual y va después de las ciudades conocidas.`);
 return {fileName,city,rows:errors.length?[]:rows,errors,warnings};
}
export function mergeCatalog(existing:Product[],incoming:Product[]){
 const merged=new Map(existing.map(p=>[p.id,p]));let added=0,updated=0,unchanged=0;
 for(const p of incoming){const old=merged.get(p.id);if(!old)added++;else if(JSON.stringify(old)===JSON.stringify(p))unchanged++;else updated++;merged.set(p.id,p);}
 return {products:[...merged.values()],added,updated,unchanged};
}
export function catalogExample(products:Product[]):Workspace{
 const selection=products.filter(p=>p.name.trim()&&['pz','pieza','piezas'].includes(p.unit.toLowerCase())).slice(0,6);
 if(!selection.length)throw Error('El catálogo no tiene artículos en piezas para probar la lista.');
 return {mode:'synthetic',catalogExample:true,products,audit:[],documents:[{id:'catalog-example',supplier:'Prueba con catálogo Masterview',reference:'PRUEBA-CATALOGO',image:null,pages:1,expectedPages:1,warnings:[],notices:['Nombres exactos del catálogo. Las cantidades de esta prueba son ficticias.'],printedTotal:null,rows:selection.map((product,i)=>({id:`example-${product.id}`,sourceRow:i+1,description:'Fila de prueba; no proviene de una factura real',supplierSku:null,barcode:null,billedQuantity:1,billedUnit:'pieza',price:null,amount:null,proposedQuantity:1,actualQuantity:null,confirmedQuantity:null,product,candidates:[product],evidence:[`Texto exacto de Retool: ${product.nameColumn??'Item'}`],flags:[],resolvedFlags:[],conversion:'Cantidad ficticia para probar la revisión.',confirmed:false}))}]};
}
