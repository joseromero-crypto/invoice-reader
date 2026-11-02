import {z} from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import {PrintedReadingSchema,type PrintedReading} from '../shared/printed-reading';
import {columnsSystem,readPrintedOutput} from './invoice-basic-columns';
import {basicInvoiceRequest} from './invoice-basic';
import {invoiceImageSizes} from './invoice-image';
import type {InvoiceImageSize} from './invoice-tables';
export const columnsV3Version='invoice-basic-columns-v3';
const records=z.array(z.array(z.string()));
// Use native types for IDs/enums and independent named handwriting records.
// Rows have only eight fixed cells plus the table's literal quantity cells.
const Wire=z.object({version:z.literal(columnsV3Version),meta:z.array(z.string()),warnings:z.array(z.string()),tables:z.array(z.object({id:z.number().int(),sourcePage:z.number().int(),quantityHeaders:z.array(z.string())}).strict()),rows:records,handwriting:z.array(z.object({sourceRow:z.number().int(),kind:z.enum(['none_seen','check_like','other','uncertain']),text:z.string().nullable(),ownership:z.enum(['row','uncertain']),candidateRows:z.array(z.number().int())}).strict()),uncertainties:records,coverage:records}).strict();
const enc=(v:string|number|null)=>v===null?'':typeof v==='number'?String(v):v===''?'~':v.startsWith('~')?'~'+v:v;
const txt=(s:string)=>s===''?null:s==='~'?'':s.startsWith('~~')?s.slice(1):s.startsWith('~')?(()=>{throw Error('Invalid source escape');})():s;
function ref(s:string){if(!/^[1-9]\d*$/.test(s)||!Number.isSafeInteger(Number(s)))throw Error('Invalid source reference');return Number(s);}
function count(s:string){if(!/^(0|[1-9]\d*)$/.test(s)||!Number.isSafeInteger(Number(s)))throw Error('Invalid source count');return Number(s);}
export function encodePrintedTablesV3(value:PrintedReading){
 const p=PrintedReadingSchema.parse(value);
 return {version:columnsV3Version,meta:[p.supplier,p.reference,p.date].map(enc),warnings:p.warnings,tables:p.tables.map(t=>({...t,quantityHeaders:t.quantityHeaders.map(enc)})),rows:p.rows.map(r=>[r.sourcePage,r.sourceRow,r.tableId,r.supplierSku,r.barcode,r.description,r.printedUnit,r.rawText,...r.printedQuantities].map(enc)),handwriting:p.rows.map(r=>({sourceRow:r.sourceRow,...r.handwriting})),uncertainties:p.rows.map(r=>[String(r.sourceRow),...r.fieldUncertainties.flatMap(f=>[f.field,enc(f.reason)])]),coverage:p.coverage.map(c=>[c.sourcePage,c.inspection,c.content,c.visibleRowCount,...c.sourceRows].map(enc))};
}
export function decodePrintedTablesV3(value:unknown):PrintedReading{
 const w=Wire.parse(value);if(w.meta.length!==3||w.coverage.some(c=>c.length<4))throw Error('Invalid printed column count');
 const tables=w.tables.map(t=>({...t,quantityHeaders:t.quantityHeaders.map(txt)})),marks=new Map(w.handwriting.map(h=>[h.sourceRow,h]));
 if(marks.size!==w.handwriting.length)throw Error('Duplicate handwriting observation');
 const doubts=new Map<number,Array<{field:string;reason:string|null}>>();
 for(const d of w.uncertainties){if(!d.length||d.length%2!==1)throw Error('Invalid printed uncertainties');const id=ref(d[0]);if(doubts.has(id))throw Error('Duplicate printed uncertainties');const fields=[];for(let i=1;i<d.length;i+=2)fields.push({field:d[i],reason:txt(d[i+1])});doubts.set(id,fields);}
 const rows=w.rows.map(r=>{
  if(r.length<9)throw Error('Invalid printed row columns');
  const id=ref(r[1]),table=tables.find(t=>t.id===ref(r[2])),h=marks.get(id);
  if(!doubts.has(id)||!table||!h||r.length!==8+table.quantityHeaders.length)throw Error('Invalid printed row columns/references');
  const {sourceRow:_id,...handwriting}=h;
  return {sourcePage:ref(r[0]),sourceRow:id,tableId:table.id,supplierSku:txt(r[3]),barcode:txt(r[4]),description:txt(r[5]),printedUnit:txt(r[6]),rawText:txt(r[7]),printedQuantities:r.slice(8).map(txt),handwriting,fieldUncertainties:doubts.get(id)};
 });
 if(doubts.size!==rows.length||marks.size!==rows.length)throw Error('Invalid printed observation references');
 return PrintedReadingSchema.parse({version:'invoice-basic-columns-v2',supplier:txt(w.meta[0]),reference:txt(w.meta[1]),date:txt(w.meta[2]),warnings:w.warnings,tables,rows,coverage:w.coverage.map(c=>({sourcePage:ref(c[0]),inspection:c[1],content:c[2],visibleRowCount:count(c[3]),sourceRows:c.slice(4).map(ref)}))});
}
export const columnsV3Instructions=`Return only invoice-basic-columns-v3. meta=[supplier,reference,date YYYY-MM-DD]. String-table unknown nullable cells are ""; genuine empty text "~"; escape literal ~ by adding ~. Printed quantities are exact TEXT, preserving source punctuation/zeros. Source references/counts are ordinary integer strings. tables is a NATIVE array of objects {id:positive INTEGER,sourcePage:positive INTEGER,quantityHeaders:[literal headers]}; use numeric IDs (never T1). Each row record has exactly EIGHT fixed string cells, then one printed quantity cell per table header: [originalPhoto,sourceRow,tableId,supplierSku,barcode,description,printedUnit,rawText,...printedQuantityCells]. No handwriting fields or candidate counts in item records. handwriting is a NATIVE array of objects, ONE per item: {sourceRow:integer,kind:none_seen/check_like/other/uncertain,text:literal readable handwriting or null,ownership:row/uncertain,candidateRows:[positive integers]}. A normal row-owned check uses kind check_like, text null, ownership row, candidateRows containing its own sourceRow. ALL observations require their own sourceRow in candidateRows, plus ONLY plausible affected neighbors if ownership uncertain. Never use an empty candidate list, zero count delimiter, or prose such as check/slash over key as literal handwriting text. No mark shape approves receipt. uncertainties explicitly has one string record per row [sourceRow,field,reason,...] or [sourceRow] after inspection; fields supplierSku/barcode/description/quantity/unit. coverage LAST has one string record per ORIGINAL PHOTO [originalPhoto,inspection,content,visibleRowCount,...visibleSourceRows]; inspection complete/incomplete; content items/non_items. Include overlaps in every relevant original's coverage, but extract each physical row once. Fixed column counts never limit item counts. Return ALL rows, no markdown.`;
export function columnsV3InvoiceRequest(model:string,images:Anthropic.ImageBlockParam[],sizes:InvoiceImageSize[]=invoiceImageSizes(images),pages=images.length){
 const request=basicInvoiceRequest(model,images,sizes,pages),schema=z.toJSONSchema(Wire,{reused:'inline'}) as Record<string,any>;delete schema.$schema;schema.properties.version={type:'string',enum:[columnsV3Version]};
 // Native schema supplies types/enums; strict positive/safe references and all
 // cross-record/source constraints remain enforced locally after decoding.
 const stripBounds=(v:any):void=>{if(!v||typeof v!=='object')return;delete v.minimum;delete v.maximum;for(const child of Object.values(v))stripBounds(child);};stripBounds(schema);
 request.system=columnsSystem+' supplierSku is the actual supplier commercial product key, including a code printed at the beginning of DESCRIPCION. CVEPROD/CveProd/CLAVE SAT is a fiscal classification, NEVER supplierSku or a product barcode. Keep that fiscal code only in rawText. A repeated fiscal classification does not replace different commercial keys embedded in product descriptions. Product GTIN/EAN/barcode digits printed inside DESCRIPCION belong in barcode too, even without a barcode glyph or separate barcode column. Transcribe both the commercial key and product barcode independently; neither replaces the other. Preserve the same literal digits in description/rawText. Independently copy the separate U.M./U. Med./UNIDAD column into printedUnit on EVERY row when visible, even when a PIEZAS quantity column also exists. A literal CAJAS row unit must remain CAJAS in printedUnit; quantity headers do not replace this source field. Use null only if no separate unit is printed or it is unreadable; state a unit-specific uncertainty when unreadable. Preserve separate printed prefix markers such as * in rawText. Never drop source units to avoid disagreement with the PIEZAS header; local code selects quantities later.'+'\n'+columnsV3Instructions;request.output_config={effort:'low',format:{type:'json_schema',schema}};return request;
}
export function readPrintedOutputV3(value:unknown,sizes:InvoiceImageSize[]){return readPrintedOutput(decodePrintedTablesV3(value),sizes);}
