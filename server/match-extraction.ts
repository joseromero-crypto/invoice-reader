import {randomUUID} from 'node:crypto';
import {convertQuantity,confirmRow,type Row,type Product,type ExtractionSchema} from '../shared/domain.ts';
import type {z} from 'zod';
import {matchProducts,supplierIdentity,unverifiedSupplierKeyFlag} from '../shared/matching.ts';
import {hasReceptionMark,hasReceptionConflict,itemFlags} from '../shared/receiving-policy.ts';
type Extraction=z.infer<typeof ExtractionSchema>;
export function buildInvoiceRows(extraction:Extraction,products:Product[],internalProducts:any[]=[],mappings:any[]=[],rules:any[]=[]){
 return extraction.rows.map(source=>{
 const candidates=matchProducts({supplier:extraction.supplier??'',supplierSku:source.supplierSku,barcode:source.barcode,description:source.description},products);
 const mapping=mappings.find(m=>supplierIdentity(m.supplier)===supplierIdentity(extraction.supplier??'')&&m.supplier_sku===source.supplierSku);
 if(mapping){const mapped=internalProducts.find(p=>p.id===mapping.product_id);const candidate=mapped?candidates.find(c=>c.product.id===mapped.external_id):undefined;if(candidate){candidate.flags=candidate.flags.filter(flag=>flag!==unverifiedSupplierKeyFlag);candidate.evidence.push('Mapeo confirmado anteriormente');candidate.score+=4;candidates.sort((a,b)=>b.score-a.score);}}
 const best=candidates[0],internal=internalProducts.find(p=>p.external_id===best?.product.id);
 const rule=rules.find(r=>r.product_id===internal?.id&&supplierIdentity(r.supplier)===supplierIdentity(extraction.supplier??'')&&(r.source_unit??'').toLowerCase()===(source.unit??'').toLowerCase());
 // Team policy: an identified catalog item is the counted piece, even when sold as a pack.
 // Missing/PQ labels do not require multiplying contents or blocking an otherwise exact match.
 // Explicit cases and weight/volume still need evidence of the correct quantity column.
 const countLabel=(source.unit??'').toLowerCase().replace(/[.\s]/g,'');
 const identified=best&&best.flags.length===0&&best.evidence.some(e=>['SKU + proveedor','Código de barras exacto','Mapeo confirmado anteriormente'].includes(e));
 const catalogCount=Boolean(identified&&['','pq','pqt','paq','paquete','paquetes','pack','packs','xpk'].includes(countLabel)&&source.quantity!==null&&Number.isInteger(source.quantity));
 const conversion=convertQuantity(source.quantity,catalogCount?'PZ':source.unit,best?.product.unit??'unknown',catalogCount?undefined:rule?Number(rule.factor):undefined);
 // PZ refers to the catalog item, including a catalog multipack. Never multiply by contents in its name.
 const piecesKnown=conversion.quantity!==null;
 const receptionMarked=!source.flags.some(hasReceptionConflict)&&(source.receptionMarked??hasReceptionMark(source.flags));
 const flags=[...itemFlags(source.flags,piecesKnown),...(best?.flags??['No hay candidato suficiente']),...(conversion.flag?[conversion.flag]:[])];
 const row:Row={id:randomUUID(),sourceRow:source.sourceRow,sourcePage:source.sourcePage,description:source.description,supplierSku:source.supplierSku,barcode:source.barcode,billedQuantity:source.quantity,billedUnit:source.unit,price:source.price,amount:source.amount,proposedQuantity:conversion.quantity,actualQuantity:null,confirmedQuantity:null,product:best?.product??null,candidates:candidates.map(c=>c.product),evidence:[...(best?.evidence??[]),...(receptionMarked?['Recepción marcada en factura']:[])],flags:[...new Set(flags)],resolvedFlags:[],conversion:conversion.flag??(catalogCount?'Cantidad del artículo identificado en catálogo; sin multiplicar el contenido del empaque.':rule?`${source.quantity} × ${rule.factor} = ${conversion.quantity} piezas Calii (conversión verificada).`:`${source.quantity} ${source.unit} = ${conversion.quantity} artículos del catálogo; sin multiplicar el contenido del empaque.`),confirmed:false,receptionMarked};
 if(!source.supplierSku&&!source.barcode&&candidates.length>1)row.flags.push('Verifica variante: propuesta solo por descripción');
 // User-defined receiving convention: a clear check confirms receipt, but never resolves product/conversion conflicts.
 const confirmed=receptionMarked&&row.flags.length===0&&row.product&&Number.isInteger(row.proposedQuantity)?{...confirmRow(row,row.product,row.proposedQuantity!,true),evidence:[...row.evidence,'Cantidad recibida confirmada por marca en factura']}:row;
 return {...confirmed,raw:source};
 });
}
