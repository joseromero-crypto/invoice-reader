// Offline only: no environment loading, network, database or provider calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parseCatalog} from '../shared/catalog';
import {ExtractionSchema,exportCsv,type Document} from '../shared/domain';
import {buildInvoiceRows} from '../server/match-extraction';
const [catalogFile,inputDir,outputFile]=process.argv.slice(2);
if(!catalogFile||!inputDir||!outputFile)throw Error('Usage: replay-saved.ts catalog.csv saved-result-directory new-output.json');
if(fs.existsSync(outputFile))throw Error('Refusing to overwrite existing evidence');
const products=parseCatalog(fs.readFileSync(catalogFile,'utf8')).products;
assert(products.length>0,'Empty catalog');
const seen=new Set<string>(),results:any[]=[];
for(const file of fs.readdirSync(inputDir).filter(f=>f.endsWith('.json')).sort()){
 const saved=JSON.parse(fs.readFileSync(path.join(inputDir,file),'utf8'));
 if(!saved?.job?.raw_result||!Array.isArray(saved.rows))continue;
 const key=saved.job.id??saved.job.document_id;if(!key||seen.has(key))continue;seen.add(key);
 const raw=ExtractionSchema.parse(saved.job.raw_result),before=JSON.stringify(raw);
 const rows=buildInvoiceRows(raw,products);
 assert.equal(JSON.stringify(raw),before,'Replay mutated source');
 assert.equal(rows.length,raw.rows.length);
 rows.forEach((row,i)=>{
  assert.equal(row.sourceRow,raw.rows[i].sourceRow);assert.equal(row.billedQuantity,raw.rows[i].quantity);
  assert.equal(row.supplierSku,raw.rows[i].supplierSku);assert.equal(row.barcode,raw.rows[i].barcode);
  assert(!row.flags.length||!row.confirmed,'Flagged row auto-confirmed');
 });
 const document:Document={id:'offline',supplier:raw.supplier??'',reference:raw.reference??'',image:null,pages:1,expectedPages:null,printedTotal:null,warnings:[],rows};
 const eligible=rows.filter(r=>r.confirmed&&!r.flags.length&&r.product);
 if(eligible.length){const output=exportCsv([document],true);assert.equal(output.excluded.length,rows.length-eligible.length);}
 results.push({file,rows:rows.length,main:rows.filter(r=>!r.flags.length).length,pending:rows.filter(r=>r.flags.length).length,confirmed:eligible.length,
  findings:rows.map(r=>({sourceRow:r.sourceRow,sourcePage:r.sourcePage,flags:r.flags,confirmed:r.confirmed,quantity:r.proposedQuantity,productId:r.product?.id??null}))});
}
assert(results.length,'No saved results found');
fs.writeFileSync(outputFile,JSON.stringify({kind:'deterministic saved-result replay; not OCR or live verification',invoices:results.length,rows:results.reduce((n,r)=>n+r.rows,0),results},null,2),{flag:'wx'});
console.log(JSON.stringify({invoices:results.length,rows:results.reduce((n,r)=>n+r.rows,0),main:results.reduce((n,r)=>n+r.main,0),pending:results.reduce((n,r)=>n+r.pending,0)}));
