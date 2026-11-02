import {randomUUID} from 'node:crypto';
import type {Product,Row} from '../shared/domain.ts';
import {mappingSupplier,rowCodes,type MatchResult} from '../lean/match.ts';
import type {Transcription} from '../lean/transcribe.ts';
const matchedLabel={barcode:'Código de barras del catálogo',supplierSku:'Clave de proveedor del catálogo',mapping:'Mapeo confirmado anteriormente'} as const;
// One invoice_rows payload per proposal: review = the proposal in the Row shape the
// confirm/export functions already use; raw = the transcribed row (raw_source).
export function leanRows(t:Transcription,result:MatchResult,products:Product[]){
 const byId=new Map(products.map(p=>[p.id,p])),supplier=mappingSupplier(result,t);
 return result.proposals.map((p,i)=>{
  const codes=rowCodes(p.row),flags=p.status==='ok'?[]:p.reasons;
  const row:Row={id:randomUUID(),sourceRow:i+1,sourcePage:p.row.photo,description:p.row.description,supplierSku:codes.keys[0]??null,barcode:codes.barcodes[0]??null,billedQuantity:null,billedUnit:p.row.unit,price:null,amount:null,proposedQuantity:p.quantity,actualQuantity:null,confirmedQuantity:null,product:(p.item&&byId.get(p.item.id))??null,candidates:p.candidates.map(c=>byId.get(c.id)).filter((c):c is Product=>!!c),evidence:p.matchedBy?[matchedLabel[p.matchedBy]]:[],flags,resolvedFlags:[],conversion:p.quantityBasis,confirmed:false,status:p.status,reasons:p.reasons,mappingSupplier:supplier,columns:t.quantityColumns??[]};
  return {...row,raw:p.row};
 });
}
// The printed date only when it is unambiguous day-first or ISO; otherwise the receiver sets it.
export function isoDate(printed:string|null){
 const s=(printed??'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return valid(+m[1],+m[2],+m[3]);
 m=s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);if(m)return valid(m[3].length===2?2000+ +m[3]:+m[3],+m[2],+m[1]);return null;
}
function valid(y:number,mo:number,d:number){const date=new Date(Date.UTC(y,mo-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d?date.toISOString().slice(0,10):null;}
