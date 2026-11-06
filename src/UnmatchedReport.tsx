import {useState} from 'react';
import {Download,LoaderCircle,Search,TriangleAlert} from 'lucide-react';
import {UNMATCHED_SHEET,unmatchedCsv,unmatchedTable,type UnmatchedRow} from '../lean/unmatched';
import {download,XLSX} from './lib/download';
import {xlsx} from './lib/xlsx';
import {api} from './lib/supabase';
export type Report={rows:UnmatchedRow[];reads:number;since:string|null;limit:number};
const fileName=(extension:string,supplier?:string)=>`sin-coincidencia-${supplier?`${supplier.replace(/[^\w-]+/g,'_')}-`:''}${new Date().toISOString().slice(0,10)}.${extension}`;
const excel=(rows:UnmatchedRow[],supplier?:string)=>download(xlsx(unmatchedTable(rows),UNMATCHED_SHEET) as Uint8Array<ArrayBuffer>,fileName('xlsx',supplier),XLSX);
const bySupplier=(rows:UnmatchedRow[])=>[...new Set(rows.map(r=>r.supplier))].map(supplier=>{const own=rows.filter(r=>r.supplier===supplier);return {supplier,rows:own,picked:own.filter(r=>r.chosen).length};}).sort((a,b)=>b.rows.length-a.rows.length||a.supplier.localeCompare(b.supplier));
// For commercial: what to fix in Masterview so the next invoice matches by itself.
export default function UnmatchedReport({load=()=>api('catalog',{action:'unmatched'})}:{load?:()=>Promise<Report>}){
 const [report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(){setBusy(true);setError('');try{setReport(await load());}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const suppliers=report?bySupplier(report.rows):[];
 return <div className="masterview-card">
  <div className="masterview-heading"><h2>Sin coincidencia en Masterview</h2>{report&&report.rows.length>0&&<div className="unmatched-actions"><button className="text-button" onClick={()=>excel(report.rows)}><Download size={15}/> Descargar Excel</button><button className="text-button" onClick={()=>download(unmatchedCsv(report.rows),fileName('csv'))}>CSV</button></div>}</div>
  <p className="catalog-help">Claves, códigos de barras y descripciones de las facturas que Masterview no pudo resolver. Al corregirlos en Masterview desaparecen de esta lista y la siguiente factura coincide sola.</p>
  {!report&&<button className="secondary" disabled={busy} onClick={run}>{busy?<LoaderCircle size={16} className="spin"/>:<Search size={16}/>} {busy?'Revisando facturas…':'Ver reporte'}</button>}
  {error&&<div className="catalog-errors" role="alert"><strong><TriangleAlert size={15}/> No se pudo generar el reporte.</strong><p>{error}</p></div>}
  {report&&(report.rows.length?<>
   <p className="catalog-help">{report.rows.length} códigos de {suppliers.length} proveedores, en {report.reads===report.limit?`las últimas ${report.limit} lecturas`:`${report.reads} lecturas`}{report.since?`, desde ${new Date(report.since).toLocaleDateString('es-MX',{dateStyle:'medium'})}`:''}.</p>
   <ul className="unmatched-list"><li className="unmatched-head"><span>Proveedor</span><span>Códigos</span><span>Con artículo elegido</span><span/></li>
   {suppliers.map(s=><li key={s.supplier}><strong>{s.supplier}</strong><span>{s.rows.length}</span><span>{s.picked}</span><button className="text-button" aria-label={`Descargar Excel de ${s.supplier}`} title="Descargar Excel" onClick={()=>excel(s.rows,s.supplier)}><Download size={15}/></button></li>)}</ul>
  </>:<p className="catalog-help">Todo lo leído coincide con Masterview.</p>)}
 </div>;
}
