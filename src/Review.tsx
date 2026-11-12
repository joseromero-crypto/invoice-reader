import {useState} from 'react';
import {Check,ChevronDown,Plus,Search,TriangleAlert,X} from 'lucide-react';
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
const City=({p}:{p:Product})=><>{p.otherCity&&<span className="c-tag c-tag--ink lean-city">Otra ciudad ({p.otherCity})</span>}{p.purchasingOff&&<span className="c-tag c-tag--ink lean-city">Compras deshabilitadas</span>}</>;
function ProductPicker({value,candidates,products,disabled,onChange,big=false}:{value:Product|null;candidates:Product[];products:Product[];disabled:boolean;onChange:(p:Product)=>void;big?:boolean}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 const q=fold(query.trim()),words=q.split(/\s+/);
 const found=q?products.filter(p=>{const hay=fold(`${p.name} ${p.aliases?.join(' ')??''} ${p.sku} ${p.supplierSku??''} ${p.barcode??''}`);return words.every(w=>hay.includes(w));}).sort((a,b)=>Number(!!a.purchasingOff)-Number(!!b.purchasingOff)).slice(0,12):[];
 const pick=(p:Product)=>{onChange(p);setOpen(false);setQuery('');};
 return <div className="lean-picker"><button type="button" className={`lean-picked${big?' big':''}${value?'':' unset'}`} disabled={disabled} onClick={()=>setOpen(!open)} aria-label={value?`Cambiar ${value.name}`:'Elegir producto'}><span><strong>{value?.name??'Elegir producto'}</strong>{value&&<City p={value}/>}</span><ChevronDown size={big?14:15}/></button>
 {open&&<div className="lean-picker-menu"><label className="search wide"><Search size={14}/><input autoFocus placeholder="Buscar en el catálogo…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
 {!q&&candidates.length>0&&<><div className="lean-picker-label">Sugeridos</div>{candidates.map(p=><button type="button" key={p.id} onClick={()=>pick(p)}>{p.name}<City p={p}/><code>{p.sku}</code></button>)}</>}
 {q&&found.map(p=><button type="button" key={p.id} onClick={()=>pick(p)}>{p.name}<City p={p}/><code>{p.sku}</code></button>)}
 {q&&!found.length&&<div className="lean-picker-label">Sin resultados</div>}
 {!q&&!candidates.length&&<div className="lean-picker-label">Escribe para buscar</div>}</div>}</div>;
}
// One line per item: Calii name + pieces are what the receiver checks; the invoice text is a muted hint.
function LeanRow({row,draft,setDraft,products,disabled,onConfirm}:{row:Row;draft:Draft;setDraft:(d:Draft)=>void;products:Product[];disabled:boolean;onConfirm:()=>void}){
 const status=rowStatus(row),reasons=row.reasons??row.flags;
 const hint=[row.description,row.supplierSku??row.barcode].filter(Boolean).join(' · ');
 return <li className={`lean-item ${status}${row.confirmed?' confirmed':''}`}>
 <div className="lean-main">{row.confirmed?<strong className="lean-name">{row.product?.name}</strong>:<ProductPicker big value={draft.product} candidates={row.candidates} products={products} disabled={disabled} onChange={p=>{const q=piecesFor(row,p);setDraft({product:p,pieces:q!==null&&Number.isInteger(q)?String(q):draft.pieces});}}/>}
 <small className="lean-hint" title={hint}>{hint}{!row.confirmed&&/×/.test(row.conversion)?` · ${row.conversion}`:''}</small>
 {!row.confirmed&&status!=='ok'&&reasons.length>0&&<small className="lean-reasons">{reasons.join(' · ')}</small>}</div>
 {row.confirmed?<strong className="lean-qty">{row.confirmedQuantity}</strong>:<input className="lean-pieces" aria-label="Piezas" inputMode="numeric" disabled={disabled} value={draft.pieces} placeholder="?" onChange={e=>setDraft({...draft,pieces:e.target.value})}/>}
 {row.confirmed?<span className="lean-done" aria-label="Confirmado"><Check size={18}/></span>:<button className={status==='ok'?'lean-tick':'lean-tick lean-confirm'} aria-label="Confirmar" title="Confirmar" disabled={disabled||!draft.product||!validPieces(draft.pieces)} onClick={onConfirm}><Check size={18}/></button>}</li>;
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
 const ready=doc.rows.filter(r=>rowStatus(r)==='ok'&&!r.confirmed).map(item).filter((c):c is Confirmation=>!!c&&!c.product.otherCity);
 const disabled=busy||readOnly;
 const table=(rows:Row[])=><ul className="lean-list"><li className="lean-head"><span>Artículo Calii</span><span>Piezas</span><span/></li>{rows.map(r=><LeanRow key={r.id} row={r} draft={draft(r)} setDraft={setDraft(r)} products={products} disabled={disabled} onConfirm={()=>{const c=item(r);if(c)onConfirm([c]);}}/>)}</ul>;
 const confirmed=doc.rows.filter(r=>r.confirmed);
 return <>
 {openWarnings.map(w=><div className="document-warning" key={w}><TriangleAlert size={16}/><span>{w}</span><button className="text-button" onClick={()=>setAcked([...acked,w])}>Entendido</button></div>)}
 <div className="table-toolbar lean-toolbar"><button className="primary" disabled={disabled||!ready.length||openWarnings.length>0} title={openWarnings.length?'Revisa las advertencias de la factura primero':undefined} onClick={()=>onConfirm(ready)}><Check size={16}/> Confirmar todos los listos ({ready.length})</button><button className="secondary" disabled={disabled} onClick={()=>setAdding(!adding)}><Plus size={16}/> Agregar renglón</button><label className="search"><Search size={15}/><input aria-label="Buscar artículo" placeholder="Buscar artículo o SKU…" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
 {adding&&<div className="lean-add"><ProductPicker value={newRow.product} candidates={[]} products={products} disabled={disabled} onChange={p=>setNewRow({...newRow,product:p})}/><input className="lean-pieces" aria-label="Piezas" inputMode="numeric" placeholder="Piezas" value={newRow.pieces} onChange={e=>setNewRow({...newRow,pieces:e.target.value})}/><input className="lean-note" placeholder="Nota (opcional)" maxLength={500} value={newRow.description} onChange={e=>setNewRow({...newRow,description:e.target.value})}/><button className="primary" disabled={disabled||!newRow.product||!validPieces(newRow.pieces)} onClick={async()=>{await onAddRow(newRow.product!,Number(newRow.pieces),newRow.description.trim());setNewRow({product:null,pieces:'',description:''});setAdding(false);}}><Check size={14}/> Agregar</button><button className="text-button" aria-label="Cancelar" onClick={()=>setAdding(false)}><X size={16}/></button></div>}
 {groups.review.length>0&&<><h3 className="lean-group review">Revisar <b>{groups.review.length}</b></h3>{table(groups.review)}</>}
 <h3 className="lean-group">Listo <b>{groups.ok.length}</b></h3>{groups.ok.length?table(groups.ok):<p className="lean-empty">Ningún renglón listo para confirmar en bloque.</p>}
 {groups.excluded.length>0&&<details className="lean-excluded"><summary><h3 className="lean-group">Tachado <b>{groups.excluded.length}</b></h3></summary><p className="lean-empty">Renglones tachados en la factura. No se incluyen salvo que los confirmes.</p>{table(groups.excluded)}</details>}
 <div className="panel-footer"><span>{confirmed.length} confirmados · <strong>{confirmed.reduce((s,r)=>s+(r.confirmedQuantity??0),0)} piezas</strong></span><span>{doc.rows.filter(r=>!r.confirmed&&rowStatus(r)!=='excluded').length} sin confirmar</span></div>
 </>;
}
