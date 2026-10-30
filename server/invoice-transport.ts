// Version 1 is an explicit wire layout, independent of object property order.
// Every source/evidence value is carried; only repeated property names go away.
export type InvoiceLayout = null | {name:string;fields:Record<string,InvoiceLayout>} | {list:InvoiceLayout};
const tuple=(name:string,fields:Record<string,InvoiceLayout>):InvoiceLayout=>({name,fields});
const list=(item:InvoiceLayout):InvoiceLayout=>({list:item});
const point=tuple('Point',{x:null,y:null});
const baseline=tuple('Baseline',{start:point,end:point});
export const invoiceLayout=tuple('Invoice',{
 supplier:null,reference:null,date:null,currency:null,printedPage:null,printedPageCount:null,printedTotal:null,warnings:list(null),
 annotationEvidence:tuple('Annotations',{
  rows:list(tuple('AnnotationRow',{sourceRow:null,sourcePage:null,inspection:null,baseline})),
  marks:list(tuple('Mark',{id:null,sourcePage:null,kind:null,text:null,quantity:null,position:point,candidateRows:list(null),anchorSupplierSku:null,association:null}))
 }),
 quantityEvidence:tuple('Quantities',{
  rows:list(tuple('QuantityRow',{sourceRow:null,sourcePage:null,baseline})),
  cells:list(tuple('Cell',{id:null,sourcePage:null,text:null,value:null,position:point,candidateRows:list(null),anchorSupplierSku:null,association:null}))
 }),
 rows:list(tuple('Row',{
  sourcePage:null,sourceRow:null,supplierSku:null,barcode:null,description:null,quantity:null,unit:null,packContents:null,price:null,discount:null,tax:null,amount:null,rawText:null,
  reception:tuple('Reception',{kind:null,text:null,quantity:null}),
  fieldUncertainties:list(tuple('Uncertainty',{field:null,reason:null})),receptionMarked:null,flags:list(null)
 }))
});
export const invoiceTransportVersion=1;

function transform(spec:InvoiceLayout,input:unknown,encode:boolean):unknown {
 if(spec===null){
  if(input!==null&&!['string','number','boolean'].includes(typeof input))throw Error('Invalid transport scalar');
  if(typeof input==='number'&&!Number.isFinite(input))throw Error('Invalid transport number');
  return input;
 }
 if('list' in spec){
  if(!Array.isArray(input))throw Error('Invalid transport list');
  return input.map(item=>transform(spec.list,item,encode));
 }
 // null is preserved only as a value. Original strict domain validation decides
 // which objects may be null (points/baselines), never a default or placeholder.
 if(input===null)return null;
 const entries=Object.entries(spec.fields);
 if(encode){
  if(typeof input!=='object'||Array.isArray(input))throw Error('Invalid transport object');
  const value=input as Record<string,unknown>;
  if(Object.keys(value).length!==entries.length||entries.some(([key])=>!Object.hasOwn(value,key)))throw Error('Missing or unexpected transport field');
  return entries.map(([key,child])=>transform(child,value[key],true));
 }
 if(!Array.isArray(input)||input.length!==entries.length)throw Error('Invalid transport tuple length');
 return Object.fromEntries(entries.map(([key,child],i)=>[key,transform(child,input[i],false)]));
}
export function encodeInvoiceTransport(value:unknown):unknown[]{return [invoiceTransportVersion,transform(invoiceLayout,value,true)];}
export function decodeInvoiceTransport(value:unknown):unknown {
 if(!Array.isArray(value)||value.length!==2||value[0]!==invoiceTransportVersion)throw Error('Unsupported invoice transport version');
 return transform(invoiceLayout,value[1],false);
}

// Generate the prompt's type table from the SAME original schema used by the
// validator. Refuse schema/layout drift instead of silently dropping a field.
type Schema=Record<string,any>;
export function invoiceTransportContract(root:Schema,pixelPoints=false):string {
 const definitions=new Map<string,string>();
 const resolve=(node:Schema):Schema=>node.$ref?resolve(node.$ref.slice(2).split('/').reduce((v:Schema,k:string)=>v[k.replace(/~1/g,'/').replace(/~0/g,'~')],root)):node;
 const render=(spec:InvoiceLayout,raw:Schema):string=>{
  const node=resolve(raw);
  if(Array.isArray(node.type))return node.type.map((type:string)=>render(spec,{...node,type})).join('|');
  if(node.anyOf)return node.anyOf.map((part:Schema)=>render(spec,part)).join('|');
  if(node.type==='null')return 'null';
  if(spec===null){
   if(!['string','number','integer','boolean'].includes(node.type))throw Error('Transport scalar schema mismatch');
   return node.type+(node.format==='date'?' (valid calendar YYYY-MM-DD)':node.description?' '+node.description:'');
  }
  if('list' in spec){
   if(node.type!=='array')throw Error('Transport list schema mismatch');
   return `list<${render(spec.list,node.items)}>`+(node.minItems?` (at least ${node.minItems})`:'');
  }
  if(node.type!=='object'||Object.keys(node.properties).length!==Object.keys(spec.fields).length||Object.keys(node.properties).some(key=>!Object.hasOwn(spec.fields,key)))throw Error('Transport object schema mismatch');
  const fields=Object.entries(spec.fields).map(([key,child])=>`${key}:${pixelPoints&&spec.name==='Point'?'number (absolute unpadded image pixels)':render(child,node.properties[key])}`);
  const definition=`${spec.name} = [${fields.join(', ')}]`;
  if(definitions.has(spec.name)&&definitions.get(spec.name)!==definition)throw Error('Conflicting transport layout');
  definitions.set(spec.name,definition);
  return spec.name;
 };
 render(invoiceLayout,root);
 return [...definitions.values()].join('\n');
}
