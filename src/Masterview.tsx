import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,LoaderCircle,RefreshCw,TriangleAlert,Upload,X} from 'lucide-react';
import {CITY_PRIORITY,cityRank,parseMasterviewFile} from '../shared/catalog';
import type {MvReport} from '../shared/masterview';
import {api,supabase} from './lib/supabase';
import UnmatchedReport from './UnmatchedReport';
type CityStatus={city:string;rows:number;updated_at:string};
type Job={id:string;state:'running'|'done'|'failed';error?:string};
type Status={cities:CityStatus[];last:{id:string;uploaded_at:string;uploaded_by:string|null;report:MvReport&{files?:{city:string;rows:number}[]}}|null;job:Job|null};
type Picked={key:string;file:File;city:string|null;rows:number;errors:string[];warnings:string[]};
const POLL_MS=3000,DROP_LIMIT=0.9;
const count=(n:number)=>n.toLocaleString('es-MX');
const shortDate=(at:string)=>new Date(at).toLocaleDateString('es-MX',{day:'2-digit',month:'2-digit'});
const fullDate=(at:string)=>new Date(at).toLocaleString('es-MX',{dateStyle:'medium',timeStyle:'short'});
async function inspect(file:File):Promise<Picked>{
 const base={key:`${file.name}-${file.size}-${file.lastModified}`,file,city:null,rows:0,warnings:[]};
 if(!file.name.toLowerCase().endsWith('.csv'))return {...base,errors:['No es un CSV.']};
 if(file.size>15000000)return {...base,errors:['Supera 15 MB.']};
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{return {...base,errors:['Exporta Masterview como CSV UTF-8.']};}
 const parsed=parseMasterviewFile(text,file.name);
 return {...base,city:parsed.city,rows:parsed.rows.length,errors:parsed.errors,warnings:parsed.warnings};
}
export default function Masterview({onClose}:{onClose:()=>void}){
 const [status,setStatus]=useState<Status|null>(null),[picked,setPicked]=useState<Picked[]>([]),[busy,setBusy]=useState(false),[running,setRunning]=useState(false),[confirmDrop,setConfirmDrop]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 const input=useRef<HTMLInputElement>(null),waiting=useRef<string|null>(null);
 const refresh=async()=>{const next:Status=await api('catalog',{action:'status'});setStatus(next);return next;};
 useEffect(()=>{let active=true;refresh().then(s=>{if(active&&s.job?.state==='running'){waiting.current=s.job.id;setRunning(true);}}).catch(e=>active&&setError((e as Error).message));return()=>{active=false;};},[]);
 useEffect(()=>{if(!running)return;const timer=setInterval(async()=>{try{const s=await refresh();if(s.job?.id!==waiting.current||s.job?.state==='running')return;setRunning(false);setBusy(false);if(s.job.state==='failed')setError(s.job.error??'La importación falló; no se cambió el catálogo.');else{setPicked([]);setConfirmDrop(false);setDone('Masterview actualizado y publicado para las otras apps.');}}catch(e){setRunning(false);setBusy(false);setError((e as Error).message);}},POLL_MS);return()=>clearInterval(timer);},[running]);
 async function choose(files:FileList|null){if(!files?.length)return;setBusy(true);setError('');setDone('');try{const added=await Promise.all([...files].map(inspect));setPicked(old=>[...old.filter(o=>!added.some(a=>a.key===o.key)),...added]);}finally{setBusy(false);if(input.current)input.current.value='';}}
 const previous=new Map(status?.cities.map(c=>[c.city,c])??[]);
 const repeated=(p:Picked)=>!!p.city&&picked.filter(o=>o.city===p.city).length>1;
 const drop=(p:Picked)=>{const before=previous.get(p.city??'')?.rows??0;return !p.errors.length&&p.rows<before*DROP_LIMIT?before:0;};
 const rowErrors=(p:Picked)=>[...p.errors,...(repeated(p)?[`Hay dos archivos de ${p.city}.`]:[])];
 const drops=picked.filter(drop),valid=picked.length>0&&picked.every(p=>!rowErrors(p).length&&p.city)&&(!drops.length||confirmDrop);
 const allCities=[...new Set([...CITY_PRIORITY,...(status?.cities.map(c=>c.city)??[])])].sort((a,b)=>cityRank(a)-cityRank(b));
 const unchanged=allCities.filter(c=>!picked.some(p=>p.city===c));
 async function start(action:()=>Promise<{job:Job}>){setBusy(true);setError('');setDone('');try{const {job}=await action();waiting.current=job.id;setRunning(true);}catch(e){setBusy(false);setError((e as Error).message);}}
 const upload=()=>start(async()=>{
  const {uploads}=await api('catalog',{action:'prepare',cities:picked.map(p=>p.city)}) as {uploads:{city:string;path:string;token:string}[]};
  await Promise.all(uploads.map(async u=>{const file=picked.find(p=>p.city===u.city)!.file;const sent=await supabase!.storage.from('catalogs').uploadToSignedUrl(u.path,u.token,file,{contentType:'text/csv'});if(sent.error)throw sent.error;}));
  return api('catalog',{action:'start',paths:uploads.map(u=>u.path),confirmDrop});});
 const reread=()=>start(()=>api('catalog',{action:'reread',confirmDrop:false}));
 const report=status?.last?.report;
 return <section className="masterview" aria-label="Masterview">
  <button className="text-button masterview-back" onClick={onClose}><ArrowLeft size={16}/> Volver</button>
  <div className="simple-title"><div><h1>Masterview</h1><p>Único lugar donde se sube Masterview. Armado CH, Sorting Hub y MH Recibo lo leen de aquí.</p></div></div>
  <div className="masterview-card">
   <input ref={input} hidden multiple type="file" accept=".csv,text/csv" onChange={e=>choose(e.target.files)}/>
   <button className="secondary" disabled={busy} onClick={()=>input.current?.click()}><Upload size={16}/> Elegir archivos</button>
   <p className="catalog-help">Un CSV completo por ciudad. Solo se reemplazan las ciudades que subas.</p>
   {picked.length>0&&<div className="masterview-files">{picked.map(p=>{const errors=rowErrors(p);return <div key={p.key}><div><strong>{p.city??'Ciudad sin detectar'}</strong><small>{p.file.name}</small></div><span>{p.rows?`${count(p.rows)} filas`:''}</span>{errors.length?<TriangleAlert size={16}/>:<Check size={16}/>}<button aria-label={`Quitar ${p.file.name}`} disabled={busy} onClick={()=>setPicked(old=>old.filter(o=>o.key!==p.key))}><X size={16}/></button>{errors.map((e,i)=><p key={i} className="masterview-row-error">{e}</p>)}{drop(p)>0&&<p className="masterview-row-error">Bajó de {count(drop(p))} a {count(p.rows)} filas (más de 10%).</p>}</div>;})}{unchanged.map(c=><div key={c} className="masterview-same"><div><strong>{c}</strong><small>sin cambios{previous.get(c)?` (última: ${shortDate(previous.get(c)!.updated_at)})`:''}</small></div></div>)}</div>}
   {drops.length>0&&<label className="masterview-confirm"><input type="checkbox" checked={confirmDrop} disabled={busy} onChange={e=>setConfirmDrop(e.target.checked)}/> Sí, es correcto</label>}
   {picked.length>0&&<button className="primary wide" disabled={busy||!valid} onClick={upload}>{busy?<LoaderCircle size={17} className="spin"/>:<Upload size={17}/>} {running?'Importando…':'Subir'}</button>}
   {running&&<p className="catalog-help" role="status">Importando. Tarda alrededor de un minuto; puedes dejar esta página abierta.</p>}
   {error&&<div className="catalog-errors" role="alert"><strong><TriangleAlert size={15}/> No se cambió el catálogo.</strong><p>{error}</p></div>}
   {done&&<p className="catalog-help" role="status">{done}</p>}
  </div>
  <div className="masterview-card">
   <div className="masterview-heading"><h2>Última actualización</h2><button className="text-button" disabled={busy||!status?.cities.length} onClick={reread}><RefreshCw size={15}/> Releer últimos archivos</button></div>
   {!status?<p className="catalog-help">Cargando…</p>:!status.last?<p className="catalog-help">Todavía no se ha importado Masterview.</p>:<>
    <p className="catalog-help">{fullDate(status.last.uploaded_at)}{status.last.uploaded_by?` · ${status.last.uploaded_by}`:''}{report?.files?` · ${report.files.map(f=>f.city).join(', ')}`:''}</p>
    <div className="table-scroll"><table className="masterview-table"><thead><tr><th>Ciudad</th><th>Filas</th><th>Solo aquí</th><th>Faltan vs Monterrey</th><th>Actualizada</th></tr></thead><tbody>{allCities.filter(c=>previous.has(c)).map(c=><tr key={c}><td>{c}</td><td>{count(previous.get(c)!.rows)}</td><td>{count(report?.cities[c]?.exclusives??0)}</td><td>{count(report?.cities[c]?.missingVsMonterrey??0)}</td><td>{shortDate(previous.get(c)!.updated_at)}</td></tr>)}</tbody></table></div>
    {report&&<><p className="catalog-help">{count(report.added)} nuevos · {count(report.updated)} actualizados · {count(report.unchanged)} sin cambios · {count(report.retired.length)} retirados</p>
    {report.nameVariants.length>0&&<details className="catalog-warnings"><summary>{report.nameVariants.length} SKUs con otro nombre según la ciudad</summary>{report.nameVariants.map(v=><p key={v.sku}>{v.sku}: {Object.entries(v.names).map(([c,n])=>`${n} (${c})`).join(' · ')}</p>)}</details>}
    {report.barcodeConflicts.length>0&&<details className="catalog-warnings"><summary>{report.barcodeConflicts.length} códigos de barras con más de un SKU</summary>{report.barcodeConflicts.map(b=><p key={b.barcode}>{b.barcode}: {b.skus.map(s=>`${s.sku} (${s.cities.join(', ')})`).join(' · ')}</p>)}</details>}
    {report.retired.length>0&&<details className="catalog-warnings"><summary>{report.retired.length} SKUs retirados</summary><p>{report.retired.join(', ')}</p></details>}
    {report.warnings.length>0&&<details className="catalog-warnings"><summary>{report.warnings.length} avisos</summary>{report.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}</>}
   </>}
  </div>
 <UnmatchedReport/>
 </section>;
}
