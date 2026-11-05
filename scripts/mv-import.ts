// Test import of the per-city Masterview exports through the same code as the admin screen, without publishing.
//   node --import tsx scripts/mv-import.ts <city.csv>... [--confirm-drop] [--out report.json]
// Writes mv_* and catalogs/masterview/{city}/latest.csv, then fills mv_product_id on the learned mappings and
// prints what doesn't map. Never touches the masterview bucket: publishing happens in the admin screen.
import fs from 'node:fs';
import {adminClient,check} from '../server/auth';
import {importMasterview} from '../server/masterview';
import {citySlug,parseMasterviewFile} from '../shared/catalog';
const argv=process.argv.slice(2),outAt=argv.indexOf('--out'),out=outAt>=0?argv.splice(outAt,2)[1]:null,confirmDrop=argv.includes('--confirm-drop');
const files=argv.filter(a=>!a.startsWith('--'));if(!files.length)throw Error('Usage: mv-import.ts <city.csv>... [--confirm-drop] [--out report.json]');
const db=adminClient();
const admins=check(await db.from('members').select('user_id').eq('role','admin'))!;if(admins.length!==1)throw Error('Expected exactly one admin to attribute the test import to');
const actor=admins[0].user_id,started=Date.now(),paths:string[]=[];
for(const file of files){
 const csv=fs.readFileSync(file,'utf8'),city=parseMasterviewFile(csv,file).city;if(!city)throw Error(`No city detected in ${file}`);
 const path=`masterview/${citySlug(city)}/incoming-${crypto.randomUUID()}.csv`;
 check(await db.storage.from('catalogs').upload(path,new Blob([csv],{type:'text/csv'}),{contentType:'text/csv'}));paths.push(path);
}
const uploaded=Date.now();
try{
 const result=await importMasterview(db,actor,{paths,confirmDrop});const imported=Date.now();
 const remap=check(await db.rpc('mv_remap_learned'));
 const {report}=result;
 console.log(JSON.stringify({version:result.version,uploadedAt:result.uploadedAt,seconds:{upload:(uploaded-started)/1000,import:(imported-uploaded)/1000},cities:report.cities,added:report.added,updated:report.updated,unchanged:report.unchanged,retired:report.retired.length,nameVariants:report.nameVariants.length,barcodeConflicts:report.barcodeConflicts.length,warnings:report.warnings,remap},null,1));
 if(out)fs.writeFileSync(out,JSON.stringify({...result,remap},null,1));
}catch(e){await db.storage.from('catalogs').remove(paths);throw e;}
