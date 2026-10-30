// Check required/closed object structure before the original Zod domain checks.
// The schema is prompt text, never sent to the provider grammar compiler.
type Schema = Record<string, any>;
function nullableValue(node:Schema):Schema|undefined {
 if(Array.isArray(node.type)){
  if(node.type.length!==2||!node.type.includes('null'))throw Error('Unsupported source type union');
  return {...node,type:node.type.find((v:string)=>v!=='null')};
 }
 if(!node.anyOf)return;
 if(node.anyOf.length!==2||node.anyOf.filter((v:Schema)=>v.type==='null').length!==1)throw Error('Unsupported source union');
 return node.anyOf.find((v:Schema)=>v.type!=='null');
}
export function assertInvoiceShape(root:Schema,value:unknown):void {
 const visit=(node:Schema,input:unknown):void=>{
  if(node.$ref){
   if(!node.$ref.startsWith('#/'))throw Error('Unsupported source reference');
   const target=node.$ref.slice(2).split('/').reduce((v:Schema,k:string)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],root);
   if(!target)throw Error('Missing source reference');
   return visit(target,input);
  }
  const known=nullableValue(node);
  if(known){if(input===null)return;return visit(known,input);}
  if(node.type==='object'){
   if(input===null||typeof input!=='object'||Array.isArray(input))throw Error('Expected source object');
   const record=input as Record<string,unknown>;
   for(const key of node.required??[])if(!Object.hasOwn(record,key))throw Error('Missing required source field');
   if(Object.keys(record).some(k=>!Object.hasOwn(node.properties,k)))throw Error('Unexpected source field');
   for(const [key,value] of Object.entries(record))visit(node.properties[key],value);
   return;
  }
  if(node.type==='array'){
   if(!Array.isArray(input))throw Error('Expected source array');
   for(const value of input)visit(node.items,value);
   return;
  }
  if(input===null||typeof input!==(node.type==='integer'?'number':node.type))throw Error('Invalid source scalar');
 };
 visit(root,value);
}
