import type {z} from 'zod';
import type {ExtractionSchema} from './domain.ts';
import {hasReceptionConflict,receptionFlags} from './receiving-policy.ts';
type Extraction=z.infer<typeof ExtractionSchema>;
type Point={x:number;y:number};
type Baseline={start:Point;end:Point};
type Association={flags:string[];check:boolean;marks:string[]};
const pending='Recepción pendiente: asociación de anotación incierta';
function projection(point:Point,line:Baseline){
 const dx=line.end.x-line.start.x,dy=line.end.y-line.start.y,length=dx*dx+dy*dy;
 if(length<1e-8)return null;
 const t=((point.x-line.start.x)*dx+(point.y-line.start.y)*dy)/length;
 const projected={x:line.start.x+t*dx,y:line.start.y+t*dy};
 return {point:projected,distance:Math.hypot(point.x-projected.x,point.y-projected.y)};
}
// This validates reported visual evidence, not pixels. Never reconstruct source
// quantities/keys from catalog data or promote uncertainty to an expected answer.
export function annotationAssociations(extraction:Extraction){
 const result=new Map<number,Association>(extraction.rows.map(r=>[r.sourceRow,{flags:[],check:false,marks:[]}]));
 const byId=new Map(extraction.rows.map(r=>[r.sourceRow,r]));
 if(byId.size!==extraction.rows.length)throw Error('Duplicate source row references');
 const neighbors=(id:number)=>{
  const row=byId.get(id)!;
  const page=extraction.rows.filter(r=>r.sourcePage===row.sourcePage);
  const i=page.findIndex(r=>r.sourceRow===id);
  return page.slice(Math.max(0,i-1),i+2).map(r=>r.sourceRow);
 };
 const block=(ids:number[],reason:string)=>{for(const id of new Set(ids))result.get(id)!.flags.push(reason);};
 const evidence=extraction.annotationEvidence;
 // Old results have no independently localized marks. A numeric correction can
 // have shifted one row in either direction: retain it as an association question
 // on the immediate same-photo neighborhood, never as a new received quantity.
 const legacyNumeric=(row:Extraction['rows'][number])=>{
  const conflict=receptionFlags(row).some(hasReceptionConflict);
  const numeric=(row.reception?.quantity!=null)||/\d/.test(row.reception?.text??'')||/(?:manuscrit[oa]|handwritten)[^;|]*\d/i.test(row.rawText)||row.flags.some(f=>/manuscrit|handwritten/i.test(f)&&/\d/.test(f));
  if(conflict&&numeric)block(neighbors(row.sourceRow),`${pending}; nota numérica sin localización independiente (fila ${row.sourceRow}). No asignar la corrección a una fila hasta revisar.`);
 };
 if(!evidence){extraction.rows.forEach(legacyNumeric);return result;}
 const inspections=new Map<number,typeof evidence.rows>();
 for(const inspected of evidence.rows){
  if(byId.get(inspected.sourceRow)?.sourcePage!==inspected.sourcePage)throw Error('Invalid annotation inspection reference');
  inspections.set(inspected.sourceRow,[...(inspections.get(inspected.sourceRow)??[]),inspected]);
 }
 for(const row of extraction.rows){
  const inspected=inspections.get(row.sourceRow);
  if(inspected?.length!==1||inspected[0].inspection!=='complete')block([row.sourceRow],`${pending}; inspección de manuscritos incompleta.`);
 }
 const seen=new Set<string>();
 for(const mark of evidence.marks){
  if(seen.has(mark.id))throw Error('Duplicate annotation id');seen.add(mark.id);
  const page=extraction.rows.filter(r=>r.sourcePage===mark.sourcePage);
  if(!page.length||mark.candidateRows.some(id=>byId.get(id)?.sourcePage!==mark.sourcePage))throw Error('Invalid annotation row/page reference');
  const anchors=mark.anchorSupplierSku===null?[]:page.filter(r=>r.supplierSku===mark.anchorSupplierSku).map(r=>r.sourceRow);
  const geometry:number[]=[];
  const missingBaselines:number[]=[];
  for(const row of page){
   const inspection=inspections.get(row.sourceRow),line=inspection?.length===1?inspection[0].baseline:null;
   const projected=line&&mark.position?projection(mark.position,line):null;
   if(!projected){if(!line||!projection(line.start,line))missingBaselines.push(row.sourceRow);continue;}
   // Compare perpendicular distance to local row spacing at the mark, allowing
   // an overlap band between neighbors. Works for sloped and vertical baselines.
   const gaps=page.filter(r=>r!==row).flatMap(other=>{
    const entries=inspections.get(other.sourceRow),otherLine=entries?.length===1?entries[0].baseline:null;
    const gap=otherLine?projection(projected.point,otherLine)?.distance:undefined;
    return gap===undefined?[]:[gap];
   });
   const tolerance=gaps.length?Math.min(...gaps)*0.65:0.015;
   if(projected.distance<=tolerance)geometry.push(row.sourceRow);
  }
  const located=[...new Set([...mark.candidateRows,...anchors,...geometry])];
  // Missing geometry only widens the local neighborhood, not every mark on
  // the photo. An unrelated unreadable baseline must not disable good checks.
  const nearbyMissing=missingBaselines.filter(id=>neighbors(id).some(n=>located.includes(n)));
  const candidates=[...new Set([...located,...nearbyMissing.flatMap(neighbors)])];
  const geometryComplete=mark.position!==null&&nearbyMissing.length===0;
  const certain=mark.association==='certain'&&geometryComplete&&geometry.length===1&&mark.candidateRows.length===1&&candidates.length===1&&(!mark.anchorSupplierSku||anchors.length===1);
  // If there is no localization at all, the affected scope is the photo. Do not
  // silently discard an observed but unassigned mark or guess an item.
  const affected=candidates.length?candidates:page.map(r=>r.sourceRow);
  for(const id of affected)result.get(id)!.marks.push(mark.id);
  if(!certain){block(affected,`${pending}; marca ${mark.id}, filas posibles ${affected.join(', ')}.`);continue;}
  const row=byId.get(candidates[0])!,association=result.get(row.sourceRow)!;
  association.flags.push(...receptionFlags({flags:[],rawText:'',quantity:row.quantity,reception:mark}));
  if(mark.kind==='check')association.check=true;
 }
 for(const row of extraction.rows){
  const association=result.get(row.sourceRow)!;
  // A row-level conflict omitted from the independent inventory is still unsafe.
  // Likewise a row check cannot confirm when the inventory did not find it.
  const local=row.reception;
  if(association.check&&local&&['none','signature'].includes(local.kind))block([row.sourceRow],`${pending}; el check del inventario contradice la observación de fila.`);
  const reported=evidence.marks.filter(m=>association.marks.includes(m.id));
  const numbers=(text:string|null|undefined)=>(text?.match(/\d+(?:\.\d+)?/g)??[]).map(Number);
  const localNumbers=[...(local?.quantity==null?[]:[local.quantity]),...numbers(local?.text),
   ...Array.from(row.rawText.matchAll(/(?:manuscrit[oa]|handwritten)[^;|]*/gi)).flatMap(m=>numbers(m[0])),
   ...row.flags.filter(f=>/manuscrit|handwritten/i.test(f)).flatMap(numbers)];
  const inventoryNumbers=reported.filter(m=>m.kind!=='check').flatMap(m=>[...numbers(m.text),...(m.quantity===null?[]:[m.quantity])]);
  const numericCovered=inventoryNumbers.length>0&&localNumbers.every(n=>n===row.quantity||inventoryNumbers.includes(n));
  if(!numericCovered)legacyNumeric(row);
  if(!association.marks.length){
   if(receptionFlags(row).some(hasReceptionConflict)||row.reception?.kind==='check'||row.receptionMarked===true)block([row.sourceRow],`${pending}; evidencia de fila ausente del inventario.`);
  }
  association.flags=[...new Set(association.flags)];
 }
 return result;
}
