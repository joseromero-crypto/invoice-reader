import {useState} from 'react';
import {Check,ChevronDown,FileImage,Plus,Search,TriangleAlert,X} from 'lucide-react';
import {quantity,type CatalogItem} from '../lean/match';
import type {TranscribedRow} from '../lean/transcribe';
import type {Document,Product,Row} from '../shared/domain';
export type Confirmation={row:Row;product:Product;quantity:number};
type Draft={product:Product|null;pieces:string};
const toItem=(p:Product):CatalogItem=>({id:p.id,name:p.name,sku:p.sku,supplier:p.supplier,supplierSku:p.supplierSku??'',barcodes:p.barcode?[p.barcode]:[],purchaseUnit:p.purchaseUnit??'',perPurchaseUnit:p.perPurchaseUnit??null});
export const rowStatus=(r:Row)=>r.status??(r.flags.length?'review':'ok');
const validPieces=(s:string)=>/^\d+$/.test(s.trim())&&Number(s)<=1000000;
const transcribed=(r:Row)=>Array.isArray(r.sourceDetails?.codes)?r.sourceDetails as unknown as TranscribedRow:null;
// Same rules as lean/match.ts: a different product can change cajas × piezas por caja.
function piecesFor(r:Row,product:Product|null){const t=transcribed(r);if(!t||!r.columns)return null;return quantity(t,r.columns,product&&toItem(product)).q;}
const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const markLabel={check:'✓ palomita',cross:'✗ tachado',none:'sin marca',other:'marca a mano'} as const;
function ProductPicker({value,candidates,products,disabled,onChange}:{value:Product|null;candidates:Product[];products:Product[];disabled:boolean;onChange:(p:Product)=>void}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 const q=fold(query.trim()),words=q.split(/\s+/);
 const found=q?products.filter(p=>{const hay=fold(`${p.name} ${p.sku} ${p.supplierSku??''} ${p.barcode??''}`);return words.every(w=>hay.includes(w));}).slice(0,12):[];
 const pick=(p:Product)=>{onChange(p);setOpen(false);setQuery('');};
 return <div className="lean-picker"><button type="button" className={`lean-picked ${value?'':'unset'}`} disabled={disabled} onClick={()=>setOpen(!open)}><span><strong>{value?.name??'Elegir producto'}</strong>{value&&<small>{value.sku}</small>}</span><ChevronDown size={15}/></button>
 {open&&<div className="lean-picker-menu"><label className="search wide"><Search size={14}/><input autoFocus placeholder="Buscar en el catálogo…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
 {!q&&candidates.length>0&&<><div className="lean-picker-label">Sugeridos</div>{candidates.map(p=><button type="button" key={p.id} onClick={()=>pick(p)}>{p.name}<code>{p.sku}</code></button>)}</>}
 {q&&found.map(p=><button type="button" key={p.id} onClick={()=>pick(p)}>{p.name}<code>{p.sku}</code></button>)}
 {q&&!found.length&&<div className="lean-picker-label">Sin resultados</div>}
 {!q&&!candidates.length&&<div className="lean-picker-label">Escribe para buscar</div>}</div>}</div>;
}
function LeanRow({row,draft,setDraft,products,image,disabled,onConfirm}:{row:Row;draft:Draft;setDraft:(d:Draft)=>void;products:Product[];image?:string;disabled:boolean;onConfirm:()=>void}){
 const t=transcribed(row),status=rowStatus(row);
 return <tr className={`lean-row ${status}${row.confirmed?' confirmed':''}`}>
 <td><div className="lean-printed">{t?.codes.map((c,i)=><code key={i}>{c.header}: {c.value}</code>)}</div><strong>{row.description}</strong>
 {t&&<div className="lean-printed">{(row.columns??[]).map((h,i)=><span key={i}>{h}: <b>{t.quantities[i]??'—'}</b></span>)}{t.unit&&<span>U.M.: <b>{t.unit}</b></span>}<span>{markLabel[t.mark]}{t.note?` (${t.note})`:''}</span>{image&&<a href={image} target="_blank" rel="noreferrer"><FileImage size={12}/> Foto {row.sourcePage}</a>}</div>}
 {!row.confirmed&&status!=='ok'&&(row.reasons??row.flags).length>0&&<small className="lean-reasons">{(row.reasons??row.flags).join(' · ')}</small>}</td>
 <td>{row.confirmed?<><strong>{row.product?.name}</strong><small>{row.product?.sku}</small></>:<ProductPicker value={draft.product} candidates={row.candidates} products={products} disabled={disabled} onChange={p=>{const q=piecesFor(row,p);setDraft({product:p,pieces:q!==null&&Number.isInteger(q)?String(q):draft.pieces});}}/>}</td>
 <td className="quantity">{row.confirmed?<strong>{row.confirmedQuantity}</strong>:<input className="lean-pieces" aria-label="Piezas" inputMode="numeric" disabled={disabled} value={draft.pieces} placeholder="?" onChange={e=>setDraft({...draft,pieces:e.target.value})}/>}{!row.confirmed&&row.conversion&&<small>{row.conversion}</small>}</td>
 <td>{row.confirmed?<span className="lean-done"><Check size={15}/> Confirmado</span>:<button className="secondary" disabled={disabled||!draft.product||!validPieces(draft.pieces)} onClick={onConfirm}><Check size={14}/> Confirmar</button>}</td></tr>;
}
export default function ReviewList({doc,products,busy,readOnly,onConfirm,onAddRow}:{doc:Document;products:Product[];busy:boolean;readOnly:boolean;onConfirm:(items:Confirmation[])=>Promise<void>;onAddRow:(product:Product,quantity:number,description:string)=>Promise<void>}){
 const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[acked,setAcked]=useState<string[]>([]),[search,setSearch]=useState('');
 const [adding,setAdding]=useState(false),[newRow,setNewRow]=useState<Draft&{description:string}>({product:null,pieces:'',description:''});
 const draft=(r:Row):Draft=>drafts[r.id]??{product:r.product,pieces:r.proposedQuantity!==null&&Number.isInteger(r.proposedQuantity)?String(r.proposedQuantity):''};
 const setDraft=(r:Row)=>(d:Draft)=>setDrafts(all=>({...all,[r.id]:d}));
 const item=(r:Row):Confirmation|null=>{const d=draft(r);return d.product&&validPieces(d.pieces)?{row:r,product:d.product,quantity:Number(d.pieces)}:null;};
 const q=search.trim().toLowerCase(),visible=doc.rows.filter(r=>!q||`${r.product?.name??''} ${r.product?.sku??''} ${r.description} ${r.supplierSku??''}`.toLowerCase().includes(q));
 const groups={ok:visible.filter(r=>rowStatus(r)==='ok'),review:visible.filter(r=>rowStatus(r)==='review'),excluded:visible.filter(r=>rowStatus(r)==='excluded')};
 const openWarnings=doc.warnings.filter(w=>!acked.includes(w));
 const ready=doc.rows.filter(r=>rowStatus(r)==='ok'&&!r.confirmed).map(item).filter((c):c is Confirmation=>!!c);
 const disabled=busy||readOnly;
 const table=(rows:Row[])=><div className="table-scroll"><table className="lean-table"><thead><tr><th>EN LA FACTURA</th><th>ARTÍCULO CALII</th><th className="quantity">PIEZAS</th><th/></tr></thead><tbody>{rows.map(r=><LeanRow key={r.id} row={r} draft={draft(r)} setDraft={setDraft(r)} products={products} image={doc.images?.[(r.sourcePage??1)-1]} disabled={disabled} onConfirm={()=>{const c=item(r);if(c)onConfirm([c]);}}/>)}</tbody></table></div>;
 const confirmed=doc.rows.filter(r=>r.confirmed);
 return <>
 {openWarnings.map(w=><div className="document-warning" key={w}><TriangleAlert size={16}/><span>{w}</span><button className="text-button" onClick={()=>setAcked([...acked,w])}>Entendido</button></div>)}
 <div className="table-toolbar lean-toolbar"><button className="primary" disabled={disabled||!ready.length||openWarnings.length>0} title={openWarnings.length?'Revisa las advertencias de la factura primero':undefined} onClick={()=>onConfirm(ready)}><Check size={16}/> Confirmar todos los listos ({ready.length})</button><button className="secondary" disabled={disabled} onClick={()=>setAdding(!adding)}><Plus size={16}/> Agregar renglón</button><label className="search"><Search size={15}/><input aria-label="Buscar artículo" placeholder="Buscar artículo o SKU…" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
 {adding&&<div className="lean-add"><ProductPicker value={newRow.product} candidates={[]} products={products} disabled={disabled} onChange={p=>setNewRow({...newRow,product:p})}/><input className="lean-pieces" aria-label="Piezas" inputMode="numeric" placeholder="Piezas" value={newRow.pieces} onChange={e=>setNewRow({...newRow,pieces:e.target.value})}/><input className="lean-note" placeholder="Nota (opcional)" maxLength={500} value={newRow.description} onChange={e=>setNewRow({...newRow,description:e.target.value})}/><button className="primary" disabled={disabled||!newRow.product||!validPieces(newRow.pieces)} onClick={async()=>{await onAddRow(newRow.product!,Number(newRow.pieces),newRow.description.trim());setNewRow({product:null,pieces:'',description:''});setAdding(false);}}><Check size={14}/> Agregar</button><button className="text-button" aria-label="Cancelar" onClick={()=>setAdding(false)}><X size={16}/></button></div>}
 <h3 className="lean-group">Listo <b>{groups.ok.length}</b></h3>{groups.ok.length?table(groups.ok):<p className="lean-empty">Ningún renglón listo para confirmar en bloque.</p>}
 <h3 className="lean-group review">Revisar <b>{groups.review.length}</b></h3>{groups.review.length?table(groups.review):<p className="lean-empty">Nada por revisar.</p>}
 {groups.excluded.length>0&&<details className="lean-excluded"><summary><h3 className="lean-group">Tachado <b>{groups.excluded.length}</b></h3></summary><p className="lean-empty">Renglones tachados en la factura. No se incluyen salvo que los confirmes.</p>{table(groups.excluded)}</details>}
 <div className="panel-footer"><span>{confirmed.length} confirmados · <strong>{confirmed.reduce((s,r)=>s+(r.confirmedQuantity??0),0)} piezas</strong></span><span>{doc.rows.filter(r=>!r.confirmed&&rowStatus(r)!=='excluded').length} sin confirmar</span></div>
 </>;
}
