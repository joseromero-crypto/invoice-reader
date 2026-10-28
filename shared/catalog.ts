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
