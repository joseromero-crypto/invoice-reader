import {z} from 'zod';
const text=z.string().nullable();
const ref=z.number().int().positive();
export const BasicReadingSchema=z.object({
 version:z.literal('invoice-basic-v1'),supplier:text,reference:text,date:z.string().date().nullable(),warnings:z.array(z.string()),
 rows:z.array(z.object({
  sourcePage:ref,sourceRow:ref,supplierSku:text,barcode:text,description:z.string().min(1),quantity:z.number().nonnegative().nullable(),unit:text,rawText:z.string().min(1),
  fieldUncertainties:z.array(z.object({field:z.enum(['supplierSku','barcode','description','quantity','unit']),reason:z.string().min(1)}).strict()),
  handwriting:z.object({kind:z.enum(['none_seen','check_like','other','uncertain']),text:text,ownership:z.enum(['row','uncertain']),candidateRows:z.array(ref)}).strict()
 }).strict()).min(1),
 coverage:z.array(z.object({sourcePage:ref,inspection:z.enum(['complete','incomplete']),content:z.enum(['items','non_items']),visibleRowCount:z.number().int().nonnegative(),sourceRows:z.array(ref)}).strict()).min(1)
}).strict();
export type BasicReading=z.infer<typeof BasicReadingSchema>;
// Structural coverage only; a consistent model omission still needs human review.
export function validateBasicReading(value:unknown,pages:number):BasicReading{
 const data=BasicReadingSchema.parse(value),rows=new Map(data.rows.map(r=>[r.sourceRow,r]));
 if(rows.size!==data.rows.length||data.rows.some((r,i)=>r.sourceRow!==i+1||r.sourcePage>pages||(i>0&&r.sourcePage<data.rows[i-1].sourcePage)))throw Error('Invalid basic source row/order');
 const coverage=new Map(data.coverage.map(c=>[c.sourcePage,c]));
 if(coverage.size!==pages||data.coverage.length!==pages)throw Error('Incomplete basic photo coverage');
 for(let p=1;p<=pages;p++){
  const c=coverage.get(p);
  if(!c||c.inspection!=='complete'||c.visibleRowCount!==c.sourceRows.length||new Set(c.sourceRows).size!==c.sourceRows.length||c.sourceRows.some(id=>!rows.has(id))||(c.content==='non_items')!==(c.sourceRows.length===0))throw Error('Invalid basic photo coverage');
 }
 for(const row of data.rows){
  if(!coverage.get(row.sourcePage)!.sourceRows.includes(row.sourceRow))throw Error('Missing basic row coverage');
  const h=row.handwriting;
  if(new Set(h.candidateRows).size!==h.candidateRows.length||h.candidateRows.some(id=>!rows.has(id)))throw Error('Invalid basic annotation reference');
  if(h.ownership==='uncertain'&&(h.candidateRows.length<1||!h.candidateRows.includes(row.sourceRow)))throw Error('Missing basic annotation candidates');
  if(h.ownership==='row'&&(h.candidateRows.length!==1||h.candidateRows[0]!==row.sourceRow))throw Error('Invalid basic row ownership');
  if(h.kind==='none_seen'&&(h.text!==null||h.ownership!=='row'))throw Error('Contradictory basic handwriting observation');
  if(h.candidateRows.some(id=>!data.coverage.some(c=>c.sourceRows.includes(id)&&c.sourceRows.includes(row.sourceRow))))throw Error('Annotation candidates do not share a photo');
 }
 return data;
}
