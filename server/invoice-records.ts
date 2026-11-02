import {economyInstructions} from './invoice-economy';
import {invoiceTableColumns,invoiceCompactTableVersion,invoiceTablesFormat,type InvoiceImageSize} from './invoice-tables';
export const invoiceRecordVersion='invoice-records-v2';
const kinds=['check','cross','circle','same_quantity','changed_quantity','return','ambiguous','signature'];
const variable:Record<string,string[]>={rowFlags:['flags'],rowUncertainties:['uncertainties'],marks:['candidateRows'],cells:['candidateRows'],coverage:['visibleSourceRows']};
const coverage=['overviewView','inspection','contentKind','visibleSupplierRowCount','...visibleSourceRows'];
const columns={...invoiceTableColumns,coverage};
function object(properties:Record<string,unknown>){return {type:'object',properties,required:Object.keys(properties),additionalProperties:false};}
const string=()=>({type:'string'}),strings=()=>({type:'array',items:string()});
export function invoiceRecordsFormat(sizes:InvoiceImageSize[]){
 const base=invoiceTablesFormat();
 const schema=structuredClone(base.schema) as any;
 schema.properties.version.enum=[invoiceRecordVersion];
 // Native grammar is deliberately small: constrain only the two observed
 // protocol failures. All other fields retain compact v7 string tables.
 schema.properties.marks={type:'array',items:object({id:string(),sourcePage:string(),kind:{type:'string',enum:kinds},text:string(),quantity:string(),positionX:string(),positionY:string(),anchorSupplierSku:string(),association:string(),candidateRows:strings()})};
 schema.properties.coverage={type:'array',items:object({overviewView:{type:'string',enum:sizes.flatMap((s,i)=>s.region?[]:[String(i+1)])},inspection:{type:'string',enum:['complete','incomplete']},contentKind:string(),visibleSupplierRowCount:string(),visibleSourceRows:strings()})};
 return {type:'json_schema' as const,schema};
}
function exactObject(value:unknown,keys:string[]):Record<string,any>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error('Invalid invoice record fields');
 return value as Record<string,any>;
}
const scalar=(v:unknown)=>{if(typeof v!=='string')throw Error('Invalid invoice record scalar');return v;};
const list=(v:unknown)=>{if(!Array.isArray(v))throw Error('Invalid invoice record list');return v;};
// Pure syntax conversion only. Never repair enums, sources, coordinates, flags,
// missing records or coverage. The complete v7/domain validator runs afterward.
export function invoiceRecordsToTables(input:unknown){
 const root=exactObject(input,['version','warnings',...Object.keys(columns)]);
 if(root.version!==invoiceRecordVersion)throw Error('Invalid invoice record version');
 const result:Record<string,any>={version:invoiceCompactTableVersion,warnings:list(root.warnings).map(scalar)};
 for(const [name,fields] of Object.entries(columns)){
  if(name!=='marks'&&name!=='coverage'){result[name]=root[name];continue;}
  const fixed=fields.filter(f=>!f.startsWith('...')),keys=[...fixed,...(variable[name]??[])];
  const decode=(raw:unknown)=>{const row=exactObject(raw,keys);const values=fixed.map(f=>scalar(row[f]));
   for(const key of variable[name]??[]){const extra=list(row[key]);
    values.push(...extra.map(scalar));
   }return values;};
  result[name]=list(root[name]).map(decode);
 }
 return result;
}
export function invoiceTablesToRecords(tables:Record<string,any>){
 const result:Record<string,any>={version:invoiceRecordVersion,warnings:tables.warnings};
 for(const [name,fields] of Object.entries(columns)){
  if(name!=='marks'&&name!=='coverage'){result[name]=tables[name];continue;}
  const fixed=fields.filter(f=>!f.startsWith('...'));
  const encode=(row:string[])=>{const value:Record<string,any>=Object.fromEntries(fixed.map((f,i)=>[f,row[i]]));
   for(const key of variable[name]??[]){const extra=row.slice(fixed.length);value[key]=extra;}
   return value;};
  result[name]=tables[name].map(encode);
 }
 return result;
}
export function invoiceRecordsInstructions(pages:number,sizes:InvoiceImageSize[]){
 const compact=economyInstructions(pages,sizes)
  .replace('invoice-tables-v7-compact',invoiceRecordVersion)
  .replace('all other tables are arrays of records (arrays of strings)','all tables except marks/coverage are arrays of records (arrays of strings); marks and coverage are named-field object records')
  .replace(/^marks=.+$/m,'marks uses the native named-field schema, with candidateRows as an array of strings')
  .replace(/^coverage=.+$/m,'coverage uses the native named-field schema, with visibleSourceRows as an array of strings')
  .replace('marks has 9 fixed cells then one cell per candidateRows; cells has 8 fixed cells then candidates.','cells has 8 fixed cells then candidates; marks uses named fields.');
 return `Coverage inspection is complete/incomplete, NEVER uncertain. Complete coverage means the whole original photo was inspected; it is NOT a claim that every field or mark is certain. Keep field/mark/geometry uncertainty in the corresponding evidence and flags.\nReturn ${invoiceRecordVersion} JSON matching the native schema. meta, warnings and ALL tables EXCEPT marks/coverage use the compact string-table encoding below. marks and coverage use native named-field OBJECT records, not positional arrays. candidateRows/visibleSourceRows are arrays of scalar strings; all other fields in marks/coverage are scalar strings. All scalar null/escape/source/coordinate rules remain identical. Use the named fields shown by the native schema.\n`+compact;
}
