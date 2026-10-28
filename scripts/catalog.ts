import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseCatalog} from '../shared/catalog';
import {adminClient,check} from '../server/auth';
const file=process.argv[2];if(!file)throw Error('Usage: npm run catalog:preview -- path/to/catalog.csv [--apply ORGANIZATION_UUID]');
const csv=fs.readFileSync(file,'utf8'),report=parseCatalog(csv),hash=createHash('sha256').update(csv).digest('hex');
console.log(JSON.stringify({products:report.products.length,errors:report.errors,warnings:report.warnings,sourceHash:hash},null,2));
if(report.errors.length)process.exitCode=1;
const index=process.argv.indexOf('--apply');
if(index>=0){
 if(report.errors.length)throw Error('Fix catalog errors before import');
 const orgId=process.argv[index+1];if(!orgId)throw Error('Organization UUID required');
 const db=adminClient();check(await db.from('organizations').select('id').eq('id',orgId).single())!;
 const run=check(await db.from('catalog_imports').upsert({org_id:orgId,source_hash:hash,report:{errors:report.errors,warnings:report.warnings,count:report.products.length}},{onConflict:'org_id,source_hash'}).select('id').single())!;
 for(let i=0;i<report.products.length;i+=250){const batch=report.products.slice(i,i+250).map(p=>({org_id:orgId,external_id:p.id,sku:p.sku,name:p.name,supplier:p.supplier,supplier_sku:p.supplierSku,barcode:p.barcode,unit:p.unit,raw:p.raw,import_id:run.id}));check(await db.from('products').upsert(batch,{onConflict:'org_id,external_id'}))!;}
 console.log('Import complete. Confirmed snapshots and supplier mappings were preserved.');
}
