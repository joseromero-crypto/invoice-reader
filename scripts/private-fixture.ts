import fs from 'node:fs';
import path from 'node:path';
import {parseCatalog} from '../shared/catalog.ts';
import type {Workspace,Product,Row,Document} from '../shared/domain.ts';
export function loadPrivate(root:string):Workspace {
 const trial=JSON.parse(fs.readFileSync(path.join(root,'trial/results.json'),'utf8'));
 const catalogDir=path.join(root,'catalog');let products:Product[]=[];
 if(fs.existsSync(catalogDir)){const csv=fs.readdirSync(catalogDir).find(x=>x.endsWith('.csv'));if(csv)products=parseCatalog(fs.readFileSync(path.join(catalogDir,csv),'utf8')).products;}
 if(!products.length&&fs.existsSync(path.join(root,'catalog.json'))){const data=JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));const rows=Array.isArray(data)?data:data.products??[];products=rows.map((r:any)=>({id:String(r.id),sku:r.sku,name:r.Item,supplier:r.Proveedor??'',supplierSku:r['SKU Proveedor']??null,barcode:r['Código de Barras']??null,unit:r['Calii Unit']??'pz',raw:r}));}
 const documents:Document[]=trial.documents.map((d:any)=>({id:d.key,supplier:d.supplier,reference:d.document_ref,image:d.image,pages:1,expectedPages:d.key.includes('arca')?2:d.key.includes('sigma')?4:1,warnings:d.key.includes('arca')?['Documento incompleto: página 1 de 2.']:d.key.includes('sigma')?['Documento incompleto: página 1 de 4.']:[],notices:(d.warnings??[]).filter((w:string)=>!w.includes('página 1 de')),printedTotal:d.printed_total??null,rows:d.rows.map((r:any):Row=>{
 const candidates=(r.candidates??[]).map((p:any)=>products.find(x=>x.id===String(p.id))??{id:String(p.id),sku:p.sku,name:p.Item,supplier:p.Proveedor??d.supplier,supplierSku:p['SKU Proveedor']??null,barcode:p['Código de Barras']??null,unit:p['Calii Unit']??'pz'});
 return {id:`${d.key}-${r.row}`,sourceDetails:Object.fromEntries(Object.entries(r).filter(([key])=>['supplier_sku','barcode','description','quantity','source_unit','unit_price','line_amount','discount','tax','notes'].includes(key))),sourceRow:r.row,sourcePage:1,description:r.description,supplierSku:r.supplier_sku??null,barcode:r.barcode??null,billedQuantity:r.quantity??null,billedUnit:r.source_unit??null,price:r.unit_price??null,amount:r.line_amount??null,proposedQuantity:r.proposed_calii_quantity??null,actualQuantity:null,confirmedQuantity:null,product:products.find(p=>p.id===String(r.proposed_calii_id))??candidates.find((p:Product)=>p.id===String(r.proposed_calii_id))??null,candidates,evidence:r.evidence??[],flags:(r.flags?.length?[(r.suggestion?.text??r.notes?.[0]??r.flags.join('; ')),...(r.suggestion?.confirmation_instruction?[r.suggestion.confirmation_instruction]:[])]:[]),resolvedFlags:[],conversion:r.conversion??'',confirmed:false};
 })}));return {documents,products,audit:[],mode:'private'};
}
