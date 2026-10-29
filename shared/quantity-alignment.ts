import type {z} from 'zod';
import type {ExtractionSchema} from './domain.ts';
type Extraction=z.infer<typeof ExtractionSchema>;
type Point={x:number;y:number};
type Line={start:Point;end:Point};
export const quantityAlignmentPending='Cantidad facturada pendiente:';
function project(p:Point,line:Line){
 const dx=line.end.x-line.start.x,dy=line.end.y-line.start.y,n=dx*dx+dy*dy;
 if(n<0.0004)return null;
 const t=((p.x-line.start.x)*dx+(p.y-line.start.y)*dy)/n;
 const point={x:line.start.x+t*dx,y:line.start.y+t*dy};
 return {point,distance:Math.hypot(p.x-point.x,p.y-point.y)};
}
// Validate evidence, never repair the provider's source values. Catalog matching
// has no role here. Legacy results have no independent geometry: leave them
// unchanged rather than claiming to certify them or blocking every old row.
export function quantityAlignments(extraction:Extraction){
 const result=new Map(extraction.rows.map(r=>[r.sourceRow,{flags:[] as string[],cells:[] as string[],evidence:undefined as Record<string,unknown>|undefined}]));
 const rows=new Map(extraction.rows.map(r=>[r.sourceRow,r]));
 if(rows.size!==extraction.rows.length)throw Error('Duplicate source row references');
 const evidence=extraction.quantityEvidence;
 if(!evidence)return result;
 const block=(ids:number[],reason:string)=>{for(const id of new Set(ids))result.get(id)!.flags.push(`${quantityAlignmentPending} ${reason}`);};
 const lines=new Map<number,Line|null>();
 for(const r of evidence.rows){
  if(rows.get(r.sourceRow)?.sourcePage!==r.sourcePage||lines.has(r.sourceRow))throw Error('Invalid quantity baseline reference');
  lines.set(r.sourceRow,r.baseline&&project(r.baseline.start,r.baseline)?r.baseline:null);
 }
 for(const row of extraction.rows)if(!lines.get(row.sourceRow))block([row.sourceRow],'línea impresa sin localización independiente; verifica la cantidad de este artículo.');
 const seen=new Set<string>(),claimed=new Map<number,string[]>();
 for(const cell of evidence.cells){
  if(seen.has(cell.id))throw Error('Duplicate printed quantity cell id');seen.add(cell.id);
  const page=extraction.rows.filter(r=>r.sourcePage===cell.sourcePage);
  if(!page.length||cell.candidateRows.some(id=>rows.get(id)?.sourcePage!==cell.sourcePage))throw Error('Invalid printed quantity row/page reference');
  const geometry:number[]=[];
  for(const row of page){
   const line=lines.get(row.sourceRow),p=line&&cell.position?project(cell.position,line):null;
   if(!p)continue;
   const gaps=page.filter(r=>r!==row).flatMap(other=>{const l=lines.get(other.sourceRow),q=l?project(p.point,l):null;return q?[q.distance]:[];});
   // A wide ambiguity band catches competing neighbors; never choose the
   // closest row when the margin is small. No horizontal y-coordinate sorting.
   if(p.distance<=(gaps.length?Math.min(...gaps)*0.65:0.01))geometry.push(row.sourceRow);
  }
  // A contradicting printed key is another plausible owner. A matching key
  // alone must not merge distinct occurrences of the same printed product.
  const anchorRows=cell.anchorSupplierSku!==null&&cell.candidateRows.some(id=>rows.get(id)?.supplierSku!==cell.anchorSupplierSku)?page.filter(r=>r.supplierSku===cell.anchorSupplierSku).map(r=>r.sourceRow):[];
  const located=[...new Set([...cell.candidateRows,...geometry,...anchorRows])];
  // An unreadable nearby baseline can invalidate an otherwise unique trace.
  const missing=page.filter(r=>!lines.get(r.sourceRow)&&located.some(id=>{
   const i=page.findIndex(p=>p.sourceRow===id),j=page.indexOf(r);return Math.abs(i-j)<=1;
  })).map(r=>r.sourceRow);
  const affected=[...new Set([...located,...missing])];
  const scope=affected.length?affected:page.map(r=>r.sourceRow);
  scope.forEach(id=>result.get(id)!.cells.push(cell.id));
  const id=cell.candidateRows[0],row=rows.get(id);
  const text=cell.text?.trim()??'';
  const numeric=/^\d+(?:[.,]\d+)?$/.test(text)?Number(text.replace(',','.')):null;
  const certain=cell.association==='certain'&&cell.position!==null&&cell.candidateRows.length===1&&geometry.length===1&&geometry[0]===id&&missing.length===0&&row&&cell.value!==null&&numeric===cell.value&&row.quantity===cell.value&&(cell.anchorSupplierSku===null||cell.anchorSupplierSku===row.supplierSku);
  for(const candidate of scope)claimed.set(candidate,[...(claimed.get(candidate)??[]),cell.id]);
  if(!certain)block(scope,`alineación o lectura de celda ${cell.id} incierta; filas posibles ${scope.join(', ')}. No usar una cantidad vecina.`);
 }
 for(const row of extraction.rows){
  const cells=claimed.get(row.sourceRow)??[];
  if(cells.length!==1)block([row.sourceRow],cells.length?'más de una celda puede pertenecer a este artículo.':'falta una celda facturada vinculada a este artículo.');
  const entry=result.get(row.sourceRow)!;entry.evidence={baselines:evidence.rows.filter(r=>r.sourceRow===row.sourceRow),cells:evidence.cells.filter(c=>entry.cells.includes(c.id))};entry.flags=[...new Set(entry.flags)];
 }
 return result;
}
