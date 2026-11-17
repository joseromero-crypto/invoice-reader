// Real check of the mh-recibo bridge, no mh-recibo needed: read an Arca DNL invoice (2 photos, one paid call ~$0.05),
// build the reception record with the live armado-ch catalog as MH San Nicolás, and link its rows to the OC lines the way
// mh-recibo will (normCode(sku_marca) / normCode(sku_key) in matchKeys). Piezas are compared with what was received
// (the session's 'cerrar' event, detalle.lineas_todas[].recibido).
//   set -a; . ./.env.local; set +a
//   node --import tsx scripts/recepcion-check.ts            (paid: saves the read to private/recepcion-bench/arca-DNL-5695519398-read.json)
//   node --import tsx scripts/recepcion-check.ts --replay   (free: re-matches the saved read)
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {transcribe,type ReadResult} from '../lean/transcribe.ts';
import {prepareImage} from '../lean/image.ts';
import {match,normCode} from '../lean/match.ts';
import {receptionRows} from '../lean/reception.ts';
import {adminClient} from '../server/auth';
import {catalog,cityItems,hubCity} from '../server/workspace';
import {leanMappings} from '../server/rematch';

const DIR='private/recepcion-bench',PHOTOS=['p1of2','p2of2'].map(p=>`${DIR}/photos/arca-DNL-5695519398-${p}.jpg`);
const SAVED=`${DIR}/arca-DNL-5695519398-read.json`,ENVIO=`${DIR}/arca-C2642861-envio.json`;
const SESSION='mh-san-nicolas__pd-arca-continental__2026-11-16__1794846172226',HUB='MH San Nicolás';
const replay=process.argv.includes('--replay');

const db=adminClient();
let read:ReadResult;
if(replay||existsSync(SAVED)&&!process.argv.includes('--fresh')){if(!existsSync(SAVED))throw Error(`No saved read at ${SAVED}`);read=JSON.parse(readFileSync(SAVED,'utf8'));console.log('Saved read (free).');}
else{
 const images=await Promise.all(PHOTOS.map(p=>prepareImage(readFileSync(p))));
 read=await transcribe(process.env.ANTHROPIC_API_KEY!,process.env.ANTHROPIC_MODEL||'claude-sonnet-5-5',images);
 writeFileSync(SAVED,JSON.stringify(read,null,2));
 const spendFile='private/lean-bench/spend.json',spend=JSON.parse(readFileSync(spendFile,'utf8'));
 spend.totalUsd+=read.costUsd;spend.calls.push({run:'recepcion-check',invoice:'arca-DNL-5695519398',model:process.env.ANTHROPIC_MODEL||'claude-sonnet-5-5',usd:read.costUsd,usage:read.usage,at:new Date().toISOString()});writeFileSync(spendFile,JSON.stringify(spend,null,2));
 console.log(`Paid read: $${read.costUsd.toFixed(4)}, ${read.seconds?.toFixed?.(1)??'?'} s`);
}
const t=read.transcription;if(!t)throw Error(`No transcription: ${read.error}`);

const hub=(await db.from('hubs').select('id').eq('name',HUB).single()).data!;
const city=await hubCity(db,hub.id),raw=await catalog(db,city),items=cityItems(raw,city);
const org=(await db.from('hubs').select('org_id').eq('id',hub.id).single()).data!.org_id;
const result=match(t,items,await leanMappings(db,org,raw),{mode:'recepcion'});
const rows=receptionRows(t,result,items);

const envio=JSON.parse(readFileSync(ENVIO,'utf8')),lines:any[]=envio.lines;
const closed=(await db.from('rec_events').select('id,detalle').eq('session_id',SESSION).eq('tipo','cerrar').order('id',{ascending:false}).limit(1).single()).data!;
const received=new Map<string,number>((closed.detalle.lineas_todas as any[]).map(l=>[l.sku_key,Number(l.recibido)]));

let linked=0,equal=0,total=0,bridged=0;const problems:string[]=[];
for(const r of rows){
 total+=r.piezas??0;
 const keys=new Set(r.matchKeys),hits=lines.filter(l=>[l.sku_marca,l.sku_key,l.barcode].some(c=>c&&keys.has(normCode(String(c)))));
 const label=`row ${r.sourceRow} ${r.printedCodes.map(c=>c.value).join('/')} "${r.printedDescription}" piezas ${r.piezas}`;
 if(hits.length!==1){problems.push(`${label}: ${hits.length?`${hits.length} OC lines (${hits.map(h=>h.producto).join('; ')})`:'no OC line'} — matchKeys ${r.matchKeys.join(',')}, sku ${r.sku??'null'}`);continue;}
 linked++;const got=received.get(hits[0].sku_key);
 // Would the printed codes alone have found it? If not, the Masterview barcode / SKU Proveedor made the link.
 const printed=new Set(r.printedCodes.map(c=>normCode(c.value)));if(![hits[0].sku_marca,hits[0].sku_key,hits[0].barcode].some(c=>c&&printed.has(normCode(String(c)))))bridged++;
 if(got===r.piezas)equal++;else problems.push(`${label} → "${hits[0].producto}": recibido ${got}`);
}
console.log(`Supplier ${result.supplier} | ref ${t.documentRef} | totalsOk ${result.totalsOk} | warnings ${JSON.stringify(result.warnings)}`);
console.log(`Invoice rows: ${rows.length} | linked to one OC line: ${linked} | piezas = recibido: ${equal} | total piezas ${total} | confident ${rows.filter(r=>r.confident).length} | linked only through Masterview codes: ${bridged}`);
console.log(`OC lines not on the invoice: ${lines.filter(l=>!rows.some(r=>[l.sku_marca,l.sku_key,l.barcode].some(c=>c&&r.matchKeys.includes(normCode(String(c)))))).map(l=>`${l.producto} (recibido ${received.get(l.sku_key)})`).join('; ')||'none'}`);
if(problems.length)console.log(problems.map(p=>`- ${p}`).join('\n'));
else console.log('All rows link and match.');
