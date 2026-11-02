import {z} from 'zod';
import {BasicReadingSchema,validateBasicReading,type BasicReading} from './basic-reading.ts';
const ref=z.number().int().positive();
const cell=z.string().min(1).nullable();
// Literal source cells are distinct from locally selected quantities. No AI
// selection, inferred units, pack multiplication or duplicate evidence inventory.
export const PrintedReadingSchema=BasicReadingSchema.omit({version:true,rows:true}).extend({
 version:z.literal('invoice-basic-columns-v2'),
 tables:z.array(z.object({id:ref,sourcePage:ref,quantityHeaders:z.array(cell).min(1).max(4)}).strict()).min(1),
 rows:z.array(BasicReadingSchema.shape.rows.element.omit({quantity:true,unit:true}).extend({tableId:ref,printedQuantities:z.array(cell).min(1).max(4),printedUnit:cell}).strict()).min(1)
}).strict();
export type PrintedReading=z.infer<typeof PrintedReadingSchema>;
export type QuantitySelection={column:number|null;quantity:number|null;unit:string|null;reason:string|null};
const label=(s:string|null)=>(s??'').trim().toUpperCase().replace(/\.$/,'');
const piece=(s:string|null)=>/^(?:(?:CANTIDAD|CANT)\.?\s+)?(?:PIEZA|PIEZAS|PZ|PZS|PZA|PZAS)$/.test(label(s));
const cases=(s:string|null)=>/^(?:CAJA|CAJAS|CJ|CJS)$/.test(label(s));
const packs=(s:string|null)=>/^(?:PQ|PQT|PAQ|PAQUETE|PAQUETES|PACK|PACKS)$/.test(label(s));
const knownUnit=(s:string|null)=>piece(s)||cases(s)||packs(s);
function printedNumber(s:string|null):number|null{
 // Commas, arithmetic, signs and other ambiguous formatting require a person.
 if(s===null||!/^\d+(?:\.\d+)?$/.test(s.trim()))return null;
 const value=Number(s.trim());return Number.isFinite(value)&&value<=1e9?value:null;
}
export function selectPrintedQuantity(headers:(string|null)[],cells:(string|null)[],rowUnit:string|null):QuantitySelection{
 if(!headers.length||headers.length!==cells.length)throw Error('Printed quantity column mismatch');
 const pieces=headers.flatMap((h,i)=>piece(h)?[i]:[]);
 const column=pieces.length===1?pieces[0]:pieces.length===0&&headers.length===1?0:null;
 if(column===null)return {column:null,quantity:null,unit:null,reason:'Selecciona la columna facturada: encabezados múltiples o ambiguos.'};
 const header=headers[column];
 // Explicit PIEZAS wins over a separate cases label. Preserve the latter in raw source.
 const unit=piece(header)||knownUnit(header)?header:rowUnit;
 if(!piece(header)&&knownUnit(header)&&rowUnit&&label(rowUnit)!==label(header)&&!(cases(header)&&cases(rowUnit))&&!(packs(header)&&packs(rowUnit)))return {column,quantity:null,unit:null,reason:'Unidad de fila y encabezado en conflicto; verifica la cantidad.'};
 const quantity=printedNumber(cells[column]);
 return {column,quantity,unit,reason:quantity===null?'Cantidad impresa ilegible o formato ambiguo; ingresa la cantidad.':unit===null?'Unidad impresa ausente o ilegible; verifica la unidad.':null};
}
export function derivePrintedReading(value:unknown,pages:number):{printed:PrintedReading;basic:BasicReading;selections:QuantitySelection[]}{
 const printed=PrintedReadingSchema.parse(value),tables=new Map(printed.tables.map(t=>[t.id,t]));
 if(tables.size!==printed.tables.length||printed.tables.some(t=>t.sourcePage>pages||!printed.rows.some(r=>r.tableId===t.id)))throw Error('Invalid printed table references');
 const selections=printed.rows.map(row=>{
  const table=tables.get(row.tableId);
  if(!table||table.sourcePage!==row.sourcePage)throw Error('Invalid printed row table/photo');
  return selectPrintedQuantity(table.quantityHeaders,row.printedQuantities,row.printedUnit);
 });
 const basic=validateBasicReading({version:'invoice-basic-v1',supplier:printed.supplier,reference:printed.reference,date:printed.date,warnings:printed.warnings,coverage:printed.coverage,rows:printed.rows.map((row,i)=>{
  const {tableId:_table,printedQuantities:_counts,printedUnit:_unit,...source}=row,selection=selections[i];
  return {...source,quantity:selection.quantity,unit:selection.unit,fieldUncertainties:[...row.fieldUncertainties,...(selection.reason?[{field:selection.quantity===null?'quantity' as const:'unit' as const,reason:selection.reason}]:[])]};
 })},pages);
 return {printed,basic,selections};
}
