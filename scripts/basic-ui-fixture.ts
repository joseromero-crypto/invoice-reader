import fs from 'node:fs';
import path from 'node:path';
import {loadPrivate} from '../scripts/private-fixture';
import {readBasicOutput} from '../server/invoice-basic';
const root='private/testing/basic-sonnet-20261030/ui';fs.mkdirSync(root);
for(const name of ['catalog','trial','invoices'])fs.symlinkSync(path.resolve('private',name),`${root}/${name}`,'dir');
const products=loadPrivate('private').products.slice(0,3);
const basic={version:'invoice-basic-v1',supplier:products[0].supplier,reference:'SYNTHETIC-UI-NOT-A-RECEIPT',date:null,warnings:[],rows:products.map((p,i)=>({sourcePage:1,sourceRow:i+1,supplierSku:p.supplierSku,barcode:p.barcode,description:p.name,quantity:i+1,unit:'PZ',rawText:`Synthetic billed row ${i+1}`,fieldUncertainties:i===2?[{field:'supplierSku',reason:'Synthetic identity doubt'}]:[],handwriting:{kind:i===1?'other':'check_like',text:i===1?'?':null,ownership:'row',candidateRows:[i+1]}})),coverage:[{sourcePage:1,inspection:'complete',content:'items',visibleRowCount:3,sourceRows:[1,2,3]}]};
fs.writeFileSync(`${root}/basic-ui.json`,JSON.stringify(readBasicOutput(basic,[{width:100,height:100,sourcePage:1}]),null,2),{flag:'wx'});
