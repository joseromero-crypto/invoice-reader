import { z } from 'zod';
export const ProductSchema = z.object({id:z.string(),sku:z.string(),name:z.string(),nameColumn:z.string().optional(),supplier:z.string(),supplierSku:z.string().nullable(),barcode:z.string().nullable(),unit:z.string(),raw:z.record(z.string(),z.unknown()).optional()});
export type Product = z.infer<typeof ProductSchema>;
export type Candidate = {product:Product; evidence:string[]; flags:string[]; score:number};
export const CorrectionsSchema=z.object({description:z.string().max(1000).optional(),supplierSku:z.string().max(100).nullable().optional(),barcode:z.string().max(100).nullable().optional()}).strict();
export type Corrections=z.infer<typeof CorrectionsSchema>;
export type Row = {id:string;revision?:number;sourceRow:number;sourcePage?:number;description:string;supplierSku:string|null;barcode:string|null;billedQuantity:number|null;billedUnit:string|null;price:string|null;amount:string|null;proposedQuantity:number|null;actualQuantity:number|null;confirmedQuantity:number|null;product:Product|null;candidates:Product[];evidence:string[];proposalEvidence?:string[];flags:string[];resolvedFlags:string[];conversion:string;confirmed:boolean;sourceDetails?:Record<string,unknown>;corrections?:Corrections};
export type Document = {id:string;scannedAt?:string;invoiceDate?:string|null;metadataRevision?:number;supplier:string;reference:string;image:string|null;images?:string[];pages:number;expectedPages:number|null;notices?:string[];warnings:string[];rows:Row[];printedTotal:string|null;jobStatus?:string;jobError?:string};
export type Audit = {at:string;action:string;rowId:string|null;before:unknown;after:unknown};
export type Workspace = {documents:Document[];products:Product[];audit:Audit[];mode:'synthetic'|'private'|'live';sessionId?:string;hubId?:string;readOnly?:boolean;catalogExample?:boolean};
const nullableText=z.string().nullable();
export const ExtractionSchema=z.object({supplier:nullableText,reference:nullableText,date:z.string().date().nullable(),currency:nullableText,printedPage:z.number().int().positive().nullable(),printedPageCount:z.number().int().positive().nullable(),printedTotal:nullableText,warnings:z.array(z.string()),rows:z.array(z.object({sourcePage:z.number().int().positive(),sourceRow:z.number().int().positive(),supplierSku:nullableText,barcode:nullableText,description:z.string().min(1),quantity:z.number().nonnegative().nullable(),unit:nullableText,packContents:z.number().positive().nullable(),price:nullableText,discount:nullableText,tax:nullableText,amount:nullableText,rawText:z.string(),flags:z.array(z.string())})).min(1)});
export function mainRows(d:Document){return d.rows.filter(r=>r.flags.length===0);}
export function pendingRows(d:Document){return d.rows.filter(r=>r.flags.length>0);}
export function pieces(rows:Row[]){return rows.reduce((sum,r)=>sum+(r.confirmedQuantity??r.proposedQuantity??0),0);}
export function confirmRow(row:Row,product:Product,quantity:number,identityChecked:boolean,corrections:Corrections={}):Row{
 if(!identityChecked||!Number.isInteger(quantity)||quantity<0)throw Error('Confirma la presentación y una cantidad entera válida.');
 return {...row,product,proposalEvidence:row.proposalEvidence??row.evidence,evidence:['Identidad y cantidad verificadas por receptor',...(product.id===row.product?.id&&Object.keys(corrections).length===0?row.evidence:[])],corrections:CorrectionsSchema.parse(corrections),actualQuantity:quantity,confirmedQuantity:quantity,confirmed:true,resolvedFlags:[...row.resolvedFlags,...row.flags],flags:[]};
}
const headers=['item_name','pieces','calii_sku','supplier_sku','barcode','evidence','calii_product_id','document_ref','source_row'];
function csvCell(value:unknown){let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function exportCsv(documents:Document[],partial=false){
 const excluded=documents.flatMap(d=>d.rows.filter(r=>!r.confirmed||r.flags.length).map(r=>`${d.reference} / ${r.sourceRow}`));
 const warnings=documents.flatMap(d=>d.warnings);
 if(!partial&&(excluded.length||warnings.length))throw Error('Hay filas sin confirmar o advertencias. Usa la exportación parcial explícita.');
 const rows=documents.flatMap(d=>d.rows.filter(r=>r.confirmed&&!r.flags.length&&r.product).map(r=>[r.product!.name,r.confirmedQuantity,r.product!.sku,r.corrections&&'supplierSku' in r.corrections?r.corrections.supplierSku:r.supplierSku,(r.corrections&&'barcode' in r.corrections?r.corrections.barcode:r.barcode)??r.product!.barcode,r.evidence.join('; '),r.product!.id,d.reference,r.sourceRow]));
 if(!rows.length)throw Error('Confirma al menos una fila contra recepción física.');
 return {csv:'\uFEFF'+[headers.map(csvCell).join(','),...rows.map(r=>r.map(csvCell).join(','))].join('\r\n'),excluded,warnings};
}
export function cents(value:string){if(!/^-?\d+(\.\d{1,8})?$/.test(value))throw Error('Importe inválido');const negative=value.startsWith('-');const [a,b='']=value.replace('-','').split('.');const rounded=BigInt(a)*100n+BigInt(b.slice(0,2).padEnd(2,'0'))+(Number(b[2]??'0')>=5?1n:0n);return rounded*(negative?-1n:1n);}
export function formatCents(value:bigint){const n=value<0n?-value:value;return `${value<0n?'-':''}${n/100n}.${String(n%100n).padStart(2,'0')}`;}
export function taxCents(amount:bigint,basisPoints:bigint){return (amount*basisPoints+5000n)/10000n;}
export function convertQuantity(quantity:number|null,sourceUnit:string|null,catalogUnit:string,verifiedFactor?:number){
 if(quantity===null)return {quantity:null,flag:'Cantidad ilegible'};
 if(!Number.isFinite(quantity)||quantity<0)return {quantity:null,flag:'Cantidad inválida'};
 const unit=(sourceUnit??'').toLowerCase();
 if(['kg','g','l','ml'].includes(unit)&&unit!==catalogUnit)return {quantity:null,flag:'Requiere flujo de unidades de peso o volumen'};
 if(verifiedFactor&&verifiedFactor>0&&Number.isInteger(quantity*verifiedFactor))return {quantity:quantity*verifiedFactor,flag:null};
 if(unit===catalogUnit||(['pieza','piezas','pz'].includes(unit)&&catalogUnit==='pz'))return {quantity,flag:null};
 return {quantity:null,flag:'Conversión de empaque sin verificar'};
}
