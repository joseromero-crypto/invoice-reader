// Native JSON tables keep syntax constrained without compiling the expanded
// domain schema. All original types and nested evidence are restored locally.
export const invoiceTableVersion='invoice-tables-v3';
export const invoicePixelTableVersion='invoice-tables-v4-pixels';
export const invoiceViewTableVersion='invoice-tables-v5-views';
export const invoiceCoverageTableVersion='invoice-tables-v6-coverage';
export const invoiceCompactTableVersion='invoice-tables-v7-compact';
export type InvoiceImageSize={width:number;height:number;dense?:true;quarterTurns?:0|1|2|3;sourcePage?:number;region?:{left:number;top:number;width:number;height:number}};
export const invoiceTableColumns={
 meta:['supplier','reference','date','currency','printedPage','printedPageCount','printedTotal'],
 rows:['sourcePage','sourceRow','supplierSku','barcode','description','quantity','unit','packContents','price','discount','tax','amount','rawText','receptionKind','receptionText','receptionQuantity','receptionMarked'],
 rowFlags:['sourceRow','...flags'],
 rowUncertainties:['sourceRow','...field,reason pairs'],
 annotationRows:['sourceRow','sourcePage','inspection','startX','startY','endX','endY'],
 marks:['id','sourcePage','kind','text','quantity','positionX','positionY','anchorSupplierSku','association','...candidateRows'],
 quantityRows:['sourceRow','sourcePage','startX','startY','endX','endY'],
 cells:['id','sourcePage','text','value','positionX','positionY','anchorSupplierSku','association','...candidateRows']
};
const keys=['version','meta','warnings','rows','rowFlags','rowUncertainties','annotationRows','marks','quantityRows','cells'];
export function invoiceTablesFormat(version=invoiceCompactTableVersion){
 const strings=()=>({type:'array',items:{type:'string'}});
 const table=()=>({type:'array',items:strings()});
 const coverage=version===invoiceCoverageTableVersion||version===invoiceCompactTableVersion;
 return {type:'json_schema' as const,schema:{type:'object',properties:{version:{type:'string',enum:[version]},meta:strings(),warnings:strings(),rows:table(),rowFlags:table(),rowUncertainties:table(),annotationRows:table(),marks:table(),quantityRows:table(),cells:table(),...(coverage?{coverage:table()}:{} )},required:coverage?[...keys,'coverage']:keys,additionalProperties:false}};
}
const jsonNumber=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const text=(value:string|null):string=>value===null?'~':value.startsWith('~')?'~'+value:value;
const number=(value:number|null):string=>value===null?'~':Object.is(value,-0)?'-0':String(value);
function toView(point:{x:number;y:number},size?:InvoiceImageSize){
 const region=size?.region;
 const x=region?(point.x-region.left)/region.width:point.x,y=region?(point.y-region.top)/region.height:point.y,q=size?.quarterTurns??0;
 const [u,v]=q===1?[1-y,x]:q===2?[1-x,1-y]:q===3?[y,1-x]:[x,y];
 return [number(u*(size?.width??1)),number(v*(size?.height??1))];
}
function fromView(x:number,y:number,size:InvoiceImageSize){
 if(x<0||y<0||x>size.width||y>size.height)throw Error('Invoice point outside supplied view');
 const u=x/size.width,v=y/size.height,q=size.quarterTurns??0;
 const point=q===1?{x:v,y:1-u}:q===2?{x:1-u,y:1-v}:q===3?{x:1-v,y:u}:{x:u,y:v};
 return size.region?{x:size.region.left+point.x*size.region.width,y:size.region.top+point.y*size.region.height}:point;
}
const line=(value:any,size?:InvoiceImageSize,nil='~'):string[]=>value?[...toView(value.start,size),...toView(value.end,size)]:[nil,nil,nil,nil];
const point=(value:any,size?:InvoiceImageSize,nil='~'):string[]=>value?toView(value,size):[nil,nil];

// Callers validate the fresh source contract before encoding. This codec does
// not infer an empty observation or a reception decision from another table.
export function encodeInvoiceTables(value:any,imageSizes?:InvoiceImageSize[]){
 const nil=imageSizes?'':'~';
 const str=(v:string|null)=>v===null?nil:imageSizes&&v===''?'~':text(v);
 const num=(v:number|null)=>v===null?nil:number(v);
 const view=(page:number)=>{
  if(!imageSizes)return page;
  const index=imageSizes.findIndex((s,i)=>(s.sourcePage??i+1)===page&&!s.region);
  if(index<0)throw Error('Missing full source overview');return index+1;
 };
 const size=(page:number)=>imageSizes?.[view(page)-1];
 return {
  version:imageSizes?invoiceCompactTableVersion:invoiceTableVersion,
  // Encoding is used for offline codec fixtures, never to invent OCR coverage.
  ...(imageSizes?{coverage:imageSizes.flatMap((s,i)=>{if(s.region)return [];const ids=value.rows.filter((r:any)=>r.sourcePage===(s.sourcePage??i+1)).map((r:any)=>num(r.sourceRow));return [[num(i+1),'complete',ids.length?'items':'non_items',num(ids.length),...ids]];})}:{}),
  meta:[str(value.supplier),str(value.reference),str(value.date),str(value.currency),num(value.printedPage),num(value.printedPageCount),str(value.printedTotal)],
  warnings:value.warnings.map(str),
  rows:value.rows.map((r:any)=>[num(view(r.sourcePage)),num(r.sourceRow),str(r.supplierSku),str(r.barcode),str(r.description),num(r.quantity),str(r.unit),num(r.packContents),str(r.price),str(r.discount),str(r.tax),str(r.amount),str(r.rawText),str(r.reception.kind),str(r.reception.text),num(r.reception.quantity),String(r.receptionMarked)]),
  rowFlags:value.rows.map((r:any)=>[num(r.sourceRow),...r.flags.map(str)]),
  rowUncertainties:value.rows.map((r:any)=>[num(r.sourceRow),...r.fieldUncertainties.flatMap((u:any)=>[str(u.field),str(u.reason)])]),
  annotationRows:value.annotationEvidence.rows.map((r:any)=>[num(r.sourceRow),num(view(r.sourcePage)),str(r.inspection),...line(r.baseline,size(r.sourcePage),nil)]),
  marks:value.annotationEvidence.marks.map((m:any)=>[str(m.id),num(view(m.sourcePage)),str(m.kind),str(m.text),num(m.quantity),...point(m.position,size(m.sourcePage),nil),str(m.anchorSupplierSku),str(m.association),...m.candidateRows.map(num)]),
  quantityRows:value.quantityEvidence.rows.map((r:any)=>[num(r.sourceRow),num(view(r.sourcePage)),...line(r.baseline,size(r.sourcePage),nil)]),
  cells:value.quantityEvidence.cells.map((c:any)=>[str(c.id),num(view(c.sourcePage)),str(c.text),num(c.value),...point(c.position,size(c.sourcePage),nil),str(c.anchorSupplierSku),str(c.association),...c.candidateRows.map(num)])
 };
}
export function decodeInvoiceTables(input:unknown,imageSizes?:InvoiceImageSize[]){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid invoice tables');
 const record=input as Record<string,unknown>;
 const compact=record.version===invoiceCompactTableVersion,nil=compact?'':'~';
 const covered=compact||record.version===invoiceCoverageTableVersion,views=covered||record.version===invoiceViewTableVersion,pixels=views||record.version===invoicePixelTableVersion;
 const expectedKeys=covered?['version','coverage',...keys.slice(1)]:keys;
 if((!pixels&&record.version!==invoiceTableVersion)||Object.keys(record).length!==expectedKeys.length||expectedKeys.some(k=>!Object.hasOwn(record,k)))throw Error('Missing or unexpected invoice table');
 const strings=(value:unknown):string[]=>{
  if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))throw Error('Invalid invoice string array');return value;
 };
 const table=(key:string):string[][]=>{
  if(!Array.isArray(record[key]))throw Error('Invalid invoice table array');return record[key].map(strings);
 };
 const count=(row:string[],n:number)=>{if(row.length!==n)throw Error('Invalid invoice table column count');};
 const minimum=(row:string[],n:number)=>{if(row.length<n)throw Error('Missing invoice table columns');};
 const str=(value:string,nullable=false):string|null=>{
  if(value===nil){if(!nullable)throw Error('Unexpected null invoice string');return null;}
  if(compact&&value==='~')return '';
  if(value.startsWith('~')&&!value.startsWith('~~'))throw Error('Invalid invoice string escape');
  return value.startsWith('~~')?value.slice(1):value;
 };
 const num=(value:string,nullable=false):number|null=>{
  if(value===nil){if(!nullable)throw Error('Unexpected null invoice number');return null;}
  if(!jsonNumber.test(value)||!Number.isFinite(Number(value)))throw Error('Invalid invoice numeric cell');return Number(value);
 };
 const id=(value:string):number=>{const n=num(value)!;if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid invoice row reference');return n;};
 const bool=(value:string):boolean=>{if(value!=='true'&&value!=='false')throw Error('Invalid invoice boolean cell');return value==='true';};
 const size=(page:number):InvoiceImageSize=>{
  if(!pixels)return {width:1,height:1};
  const value=imageSizes?.[page-1];
  if(!value||!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<=0||value.height<=0||![0,1,2,3].includes(value.quarterTurns??0))throw Error('Missing trusted image pixel dimensions');return value;
 };
 const source=(view:number):number=>{
  if(!views)return view;
  const value=size(view),page=value.sourcePage??view;
  if(!Number.isSafeInteger(page)||page<1||page>8)throw Error('Invalid trusted original page');return page;
 };
 const baseline=(values:string[],page:number)=>{
  count(values,4);const dimensions=size(page);if(values.every(v=>v===nil))return null;
  return {start:fromView(num(values[0])!,num(values[1])!,dimensions),end:fromView(num(values[2])!,num(values[3])!,dimensions)};
 };
 const position=(values:string[],page:number)=>{
  count(values,2);const dimensions=size(page);if(values.every(v=>v===nil))return null;return fromView(num(values[0])!,num(values[1])!,dimensions);
 };
 const validRegion=(s:InvoiceImageSize)=>!s.region||(Object.values(s.region).every(Number.isFinite)&&s.region.left>=0&&s.region.top>=0&&s.region.width>0&&s.region.height>0&&s.region.left+s.region.width<=1+1e-12&&s.region.top+s.region.height<=1+1e-12);
 if(pixels&&(!imageSizes?.length||imageSizes.some(s=>!Number.isSafeInteger(s.width)||!Number.isSafeInteger(s.height)||s.width<=0||s.height<=0||![0,1,2,3].includes(s.quarterTurns??0)||!validRegion(s))))throw Error('Missing trusted image pixel dimensions');
 const meta=strings(record.meta);count(meta,7);
 const sourceRows=table('rows');sourceRows.forEach(r=>count(r,17));
 const rowIds=sourceRows.map(r=>id(r[1]));
 if(new Set(rowIds).size!==rowIds.length)throw Error('Duplicate source row references');
 const observations=(name:string)=>{
  const entries=new Map<number,string[]>();
  for(const row of table(name)){
   minimum(row,1);const key=id(row[0]);
   if(!rowIds.includes(key)||entries.has(key))throw Error('Invalid per-row observation reference');entries.set(key,row.slice(1));
  }
  if(entries.size!==rowIds.length)throw Error('Missing explicit per-row observation');return entries;
 };
 if(covered){
  const originals=new Map<number,number>();
  imageSizes!.forEach((s,i)=>{if(!s.region){const page=s.sourcePage??i+1;if(originals.has(page))throw Error('Duplicate source overview');originals.set(page,i+1);}});
  const seen=new Set<number>(),coveredRows=new Set<number>();
  for(const entry of table('coverage')){
   minimum(entry,4);const view=id(entry[0]),page=source(view),declared=num(entry[3])!;
   if(originals.get(page)!==view||seen.has(page))throw Error('Invalid original photo coverage reference');seen.add(page);
   if(entry[1]!=='complete')throw Error('Incomplete original photo inspection');
   const ids=entry.slice(4).map(id);
   if(!Number.isSafeInteger(declared)||declared!==ids.length||new Set(ids).size!==ids.length||ids.some(row=>!rowIds.includes(row)))throw Error('Invalid visible supplier row coverage');
   if(!['items','non_items'].includes(entry[2])||(entry[2]==='items')!==(ids.length>0))throw Error('Invalid original photo content classification');
   const assigned=sourceRows.filter(r=>source(id(r[0]))===page).map(r=>id(r[1]));
   if(assigned.some(row=>!ids.includes(row)))throw Error('Missing source row in original photo coverage');
   ids.forEach(row=>coveredRows.add(row));
  }
  if(seen.size!==originals.size||rowIds.some(row=>!coveredRows.has(row)))throw Error('Missing original photo coverage');
 }
 const flags=observations('rowFlags'),uncertainties=observations('rowUncertainties');
 const rows=sourceRows.map(r=>{
  if(views&&size(id(r[0])).region)throw Error('Item rows require full source overview');
  const rowId=id(r[1]),fields=uncertainties.get(rowId)!;
  if(fields.length%2)throw Error('Invalid field uncertainty pair');
  return {sourcePage:source(id(r[0])),sourceRow:rowId,supplierSku:str(r[2],true),barcode:str(r[3],true),description:str(r[4])!,quantity:num(r[5],true),unit:str(r[6],true),packContents:num(r[7],true),price:str(r[8],true),discount:str(r[9],true),tax:str(r[10],true),amount:str(r[11],true),rawText:str(r[12])!,reception:{kind:str(r[13])!,text:str(r[14],true),quantity:num(r[15],true)},receptionMarked:bool(r[16]),fieldUncertainties:Array.from({length:fields.length/2},(_,i)=>({field:str(fields[i*2])!,reason:str(fields[i*2+1])!})),flags:flags.get(rowId)!.map(v=>str(v)!)};
 });
 return {
  supplier:str(meta[0],true),reference:str(meta[1],true),date:str(meta[2],true),currency:str(meta[3],true),printedPage:num(meta[4],true),printedPageCount:num(meta[5],true),printedTotal:str(meta[6],true),warnings:strings(record.warnings).map(v=>str(v)!),rows,
  annotationEvidence:{rows:table('annotationRows').map(r=>{count(r,7);return {sourceRow:id(r[0]),sourcePage:source(id(r[1])),inspection:str(r[2])!,baseline:baseline(r.slice(3),id(r[1]))};}),marks:table('marks').map(r=>{minimum(r,9);return {id:str(r[0])!,sourcePage:source(id(r[1])),kind:str(r[2])!,text:str(r[3],true),quantity:num(r[4],true),position:position(r.slice(5,7),id(r[1])),anchorSupplierSku:str(r[7],true),association:str(r[8])!,candidateRows:r.slice(9).map(id)};})},
  quantityEvidence:{rows:table('quantityRows').map(r=>{count(r,6);return {sourceRow:id(r[0]),sourcePage:source(id(r[1])),baseline:baseline(r.slice(2),id(r[1]))};}),cells:table('cells').map(r=>{minimum(r,8);return {id:str(r[0])!,sourcePage:source(id(r[1])),text:str(r[2],true),value:num(r[3],true),position:position(r.slice(4,6),id(r[1])),anchorSupplierSku:str(r[6],true),association:str(r[7])!,candidateRows:r.slice(8).map(id)};})}
 };
}
