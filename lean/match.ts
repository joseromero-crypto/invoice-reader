// Lean reader, step 2: deterministic matching + quantity rules. No AI, no cost.
// Input: a Transcription (lean/transcribe.ts) and the Calii catalog.
// Output: one proposal per row with a status the review screen can act on:
//   ok       → identity by barcode/supplier SKU, quantity resolved, row ticked. Bulk-confirmable.
//   review   → something needs a human (reasons say what). Never auto-confirmed.
//   excluded → row crossed out on the invoice. Left out of the receiving list by default.

import type { Transcription, TranscribedRow } from './transcribe.ts';

export interface CatalogItem {
  id: string;
  name: string;          // "Item" column (exact Retool text)
  sku: string;           // Calii sku
  supplier: string;      // Proveedor
  supplierSku: string;   // SKU Proveedor
  barcodes: string[];    // Código de Barras (may hold several)
  purchaseUnit: string;  // Unidad de compra (Caja / Pieza / '')
  perPurchaseUnit: number | null; // Peso neto o piezas (por unidad de compra)
}

export interface Candidate { id: string; name: string; sku: string; score: number }

export interface Proposal {
  row: TranscribedRow;
  item: CatalogItem | null;
  matchedBy: 'barcode' | 'supplierSku' | 'mapping' | null;
  candidates: Candidate[];
  quantity: number | null;
  quantityBasis: string;
  status: 'ok' | 'review' | 'excluded';
  reasons: string[];
}

export interface MatchResult {
  supplier: string | null;
  proposals: Proposal[];
  totalsOk: boolean | null;   // null = invoice prints no quantity total
  warnings: string[];         // document-level, shown above the list; a failed total blocks bulk confirm
}

// Confirmed supplier code → Calii id mappings learned from past receipts (key: `${supplier}|${code}`).
export type Mappings = Map<string, string>;

const clean = (v: unknown) => { const s = String(v ?? '').trim(); return s === '-' || s === "'-" ? '' : s; };
// One Retool masterview row (CSV export, or the whitelisted raw columns in the database) → CatalogItem.
export function catalogItem(r: Record<string, unknown>): CatalogItem {
  const n = parseFloat(clean(r['Peso neto o piezas (por unidad de compra)']).replace(',', '.'));
  return {
    id: clean(r['id']),
    name: clean(r['Item']),
    sku: clean(r['sku']),
    supplier: clean(r['Proveedor']),
    supplierSku: clean(r['SKU Proveedor']),
    barcodes: clean(r['Código de Barras']).split(/[,;/\s]+/).filter(Boolean),
    purchaseUnit: clean(r['Unidad de compra']),
    perPurchaseUnit: Number.isFinite(n) && n > 0 ? n : null,
  };
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function normCode(v: string): string {
  const s = String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
}
const isBarcodeHeader = (h: string) => /BARRA|EAN|UPC|GTIN/i.test(h);
const isFiscal = (h: string, v: string) =>
  /CVE ?PROD|PROD\.? ?SERV|\bSAT\b|CLAVE ?PROD|CLAVE ?SAT|OBJETO/i.test(h) || /^5\d{7}$/.test(v.replace(/\D/g, ''));

export function rowCodes(row: TranscribedRow) {
  const barcodes = new Set<string>(), keys = new Set<string>();
  for (const c of row.codes ?? []) {
    const n = normCode(c.value); if (!n) continue;
    if (isBarcodeHeader(c.header)) { barcodes.add(n); continue; }
    if (isFiscal(c.header, c.value)) continue;
    keys.add(n);
    if (/^\d{8,14}$/.test(n)) barcodes.add(n); // long numeric code may be a barcode
  }
  for (const m of (row.description ?? '').matchAll(/\d{8,14}/g)) if (!/^5\d{7}$/.test(m[0])) barcodes.add(normCode(m[0]));
  return { barcodes: [...barcodes], keys: [...keys] };
}

// Codes a confirmed mapping is saved under and looked up by (fiscal codes never count).
export function mappingKeys(row: TranscribedRow): string[] { const c = rowCodes(row); return [...new Set([...c.keys, ...c.barcodes])]; }
// Supplier name mappings are keyed by: the catalog supplier when detected, else the printed name.
export const mappingSupplier = (r: MatchResult, t: Transcription) => r.supplier ?? t.supplier?.trim() ?? '';

// ---------- description similarity (fallback suggestions only) ----------
function tokens(s: string): Set<string> {
  const t = fold(s)
    .replace(/(\d+(?:[.,]\d+)?)\s*(ml|lt|l|g|gr|grs|kg|oz|pz|pzs)\b/g, (_, n, u) => ` ${String(parseFloat(n.replace(',', '.')))}${u === 'gr' || u === 'grs' ? 'g' : u === 'lt' ? 'l' : u === 'pzs' ? 'pz' : u} `)
    .split(/[^a-z0-9.]+/).filter(w => w.length > 1 && !['de', 'con', 'sin', 'nr', 'pet', 'la', 'el', 'pz'].includes(w));
  return new Set(t);
}
function similarity(a: Set<string>, b: Set<string>) {
  let hit = 0; for (const w of a) if (b.has(w)) hit += /\d/.test(w) ? 2 : 1; // sizes weigh double
  let tot = 0; for (const w of a) tot += /\d/.test(w) ? 2 : 1;
  return tot ? hit / tot : 0;
}

// ---------- quantities ----------
const num = (s: string | null | undefined) => {
  if (s == null) return null; const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null;
};
const isPieceHeader = (h: string) => /PIEZ|PZA|\bPZS?\b|\bEA\b(?!.*CAJ)/i.test(h) && !/CAJ/i.test(h);
const isCaseHeader = (h: string) => /CAJ|\bCJ\b|BULTO|\bCS\b/i.test(h);
const pieceUnit = (u: string | null) => !!u && /^(PZ|PZA|PZAS|PIEZA|PIEZAS|PIEZA\(S\)|EA|H87|UNIDAD|UN|UND)$/i.test(u.trim());
const caseUnit = (u: string | null) => !!u && /CAJ|^CJ$|XBX|^CS$/i.test(u.trim());

export function quantity(row: TranscribedRow, cols: string[], item: CatalogItem | null): { q: number | null; basis: string; ok: boolean; note?: string } {
  const vals = cols.map((_, i) => num(row.quantities?.[i]));
  const pi = cols.findIndex((h, i) => isPieceHeader(h) && vals[i] != null);
  const ci = cols.findIndex((h, i) => isCaseHeader(h) && vals[i] != null);
  const n = item?.perPurchaseUnit ?? null;
  const itemByCase = !!item && /caja/i.test(item.purchaseUnit);
  if (pi >= 0) {
    const pz = vals[pi]!;
    if (ci >= 0 && itemByCase && n && Math.abs(vals[ci]! * n - pz) > 1e-6)
      return { q: pz, basis: `${cols[pi]} ${pz}`, ok: false, note: `${cols[ci]} ${vals[ci]} × ${n} pz/caja = ${vals[ci]! * n}, pero ${cols[pi]} dice ${pz}` };
    return { q: pz, basis: ci >= 0 && n && itemByCase ? `${cols[pi]} ${pz} (= ${vals[ci]} cajas × ${n})` : `${cols[pi]} ${pz}`, ok: true };
  }
  const oi = ci >= 0 ? ci : vals.findIndex(v => v != null);
  if (oi < 0) return { q: null, basis: 'sin cantidad legible', ok: false };
  const v = vals[oi]!;
  const inCases = ci >= 0 || caseUnit(row.unit);
  if (!item) return pieceUnit(row.unit) && !inCases
    ? { q: v, basis: `${v} ${row.unit}`, ok: true }
    : { q: null, basis: `${cols[oi] ?? 'cantidad'} ${v} (elige el producto para convertir)`, ok: false };
  if (!item.purchaseUnit || (itemByCase && !n)) return { q: v, basis: `${cols[oi]} ${v}`, ok: false, note: 'el catálogo no tiene unidad de compra/piezas por caja' };
  if (!itemByCase || n === 1) return { q: v, basis: `${cols[oi]} ${v} (catálogo: 1 ${item.purchaseUnit || 'pieza'} = 1)`, ok: true };
  if (inCases) return { q: v * n!, basis: `${v} cajas × ${n} pz/caja (catálogo)`, ok: true };
  if (pieceUnit(row.unit)) return { q: v, basis: `${v} ${row.unit}`, ok: true };
  return { q: v, basis: `${cols[oi]} ${v}`, ok: false, note: `¿${v} piezas o ${v} cajas (= ${v * n!} pz)? El catálogo compra por caja de ${n}` };
}

// ---------- main ----------
export function match(t: Transcription, catalog: CatalogItem[], mappings: Mappings = new Map()): MatchResult {
  const byBarcode = new Map<string, CatalogItem[]>();
  for (const it of catalog) for (const b of it.barcodes) { const k = normCode(b); if (k.length >= 6) byBarcode.set(k, [...(byBarcode.get(k) ?? []), it]); }

  const rows = t.rows ?? [];
  // A printed pieces total (e.g. Bimbo "PIEZAS EN VENTA 136") that equals the sum of an unlabeled
  // quantity column proves that column counts pieces.
  const cols = (t.quantityColumns ?? []).map((h, i) => {
    if (isPieceHeader(h) || isCaseHeader(h)) return h;
    const sum = rows.reduce((a, r) => a + (num(r.quantities?.[i]) ?? 0), 0);
    const total = (t.printedTotals ?? []).find(x => /PIEZ|PZA/i.test(x.label) && !/CAJ/i.test(x.label) && num(x.value) === sum);
    return sum > 0 && total ? `${h} (piezas: suma = ${total.label} ${num(total.value)})` : h;
  });
  const codes = rows.map(rowCodes);

  // Supplier: the catalog supplier whose barcodes/SKUs explain the most rows (printed legal names often
  // differ from catalog names, e.g. "Comercializadora de Lácteos" = LALA). Fall back to the printed name.
  const skuGlobal = new Map<string, CatalogItem[]>();
  for (const it of catalog) { const k = normCode(it.supplierSku); if (k) skuGlobal.set(k, [...(skuGlobal.get(k) ?? []), it]); }
  const votes = new Map<string, number>();
  codes.forEach(c => {
    const hit = new Set<string>();
    for (const b of c.barcodes) for (const it of byBarcode.get(b) ?? []) hit.add(it.supplier);
    for (const k of c.keys) for (const it of skuGlobal.get(k) ?? []) hit.add(it.supplier);
    for (const s of hit) votes.set(s, (votes.get(s) ?? 0) + 1);
  });
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  let supplier = ranked[0] && ranked[0][1] >= Math.max(2, rows.length * 0.3) ? ranked[0][0] : null;
  if (!supplier && t.supplier) {
    const printed = fold(t.supplier);
    const names = [...new Set(catalog.map(c => c.supplier))].filter(Boolean);
    supplier = names.find(s => fold(s).split(/\s+/).some(w => w.length > 3 && printed.includes(w))) ?? null;
  }
  const pool = supplier ? catalog.filter(c => c.supplier === supplier) : catalog;
  const bySku = new Map<string, CatalogItem[]>();
  for (const it of pool) { const k = normCode(it.supplierSku); if (k) bySku.set(k, [...(bySku.get(k) ?? []), it]); }
  const poolTokens = pool.map(it => [it, tokens(it.name)] as const);
  const allTokens = supplier ? catalog.map(it => [it, tokens(it.name)] as const) : poolTokens;

  const proposals = rows.map((row, i): Proposal => {
    const reasons: string[] = [];
    const { barcodes, keys } = codes[i];
    let item: CatalogItem | null = null, matchedBy: Proposal['matchedBy'] = null;

    const mapSupplier = supplier ?? t.supplier?.trim() ?? '';
    for (const k of [...keys, ...barcodes]) { const id = mappings.get(`${mapSupplier}|${k}`); const hit = id && catalog.find(c => c.id === id); if (hit) { item = hit; matchedBy = 'mapping'; break; } }
    const bcHits = [...new Set(barcodes.flatMap(b => byBarcode.get(b) ?? []))];
    let skuHits = [...new Set(keys.flatMap(k => bySku.get(k) ?? []))];
    const desc = tokens(row.description ?? '');
    // Distributors (e.g. Alpura routes) also deliver other brands: fall back to the whole catalog, but only
    // to items whose name resembles the printed description (short codes like "14" repeat across suppliers).
    if (!skuHits.length) skuHits = [...new Set(keys.flatMap(k => skuGlobal.get(k) ?? []))].filter(it => similarity(desc, tokens(it.name)) >= 0.3);
    if (!item && bcHits.length === 1) { item = bcHits[0]; matchedBy = 'barcode'; }
    else if (!item && bcHits.length > 1) reasons.push('código de barras en varios productos del catálogo');
    if (!item && skuHits.length === 1) { item = skuHits[0]; matchedBy = 'supplierSku'; }
    else if (!item && skuHits.length > 1) reasons.push('clave de proveedor en varios productos');
    if (item && matchedBy === 'barcode' && skuHits.length && !skuHits.includes(item)) reasons.push(`clave ${keys.join('/')} apunta a otro producto (${skuHits[0].name}); se usó el código de barras`);

    const rank = (list: (readonly [CatalogItem, Set<string>])[]) => list.map(([it, tk]) => ({ id: it.id, name: it.name, sku: it.sku, score: similarity(desc, tk) }))
      .filter(c => c.score > 0.25).sort((a, b) => b.score - a.score).slice(0, 3);
    let candidates = item ? [] : rank(poolTokens);
    if (!item && (candidates[0]?.score ?? 0) < 0.5) candidates = [...candidates, ...rank(allTokens)].sort((a, b) => b.score - a.score).filter((c, k, a) => a.findIndex(x => x.id === c.id) === k).slice(0, 3);
    for (const c of bcHits.length > 1 ? bcHits : skuHits.length > 1 ? skuHits : []) candidates.unshift({ id: c.id, name: c.name, sku: c.sku, score: 1 });
    if (!item) reasons.push(candidates.length ? 'elegir producto (sin código coincidente)' : 'producto no encontrado en catálogo');

    const q = quantity(row, cols, item);
    if (!q.ok) reasons.push(q.note ?? 'confirmar cantidad');

    let status: Proposal['status'];
    if (row.mark === 'cross') { status = 'excluded'; reasons.unshift('tachado en la factura'); }
    else {
      if (row.mark === 'none') reasons.push('sin palomita');
      if (row.mark === 'other') reasons.push(`marca a mano: ${row.note ?? 'no clara'}`);
      status = reasons.length ? 'review' : 'ok';
    }
    return { row, item, matchedBy, candidates, quantity: q.q, quantityBasis: q.basis, status, reasons };
  });
  // Free sanity check: printed quantity totals vs the sum of each quantity column.
  const warnings: string[] = [];
  let totalsOk: boolean | null = null;
  for (const t0 of t.printedTotals ?? []) {
    const v = num(t0.value); if (v == null || /KILO|\bKG|PESO|LITRO|IMPORTE|\$/i.test(t0.label)) continue;
    if (/RENGL|PARTIDAS|LINEAS/i.test(t0.label)) {
      if (v !== rows.length) { totalsOk = false; warnings.push(`La factura dice ${v} renglones y se leyeron ${rows.length}.`); } else totalsOk = totalsOk ?? true;
      continue;
    }
    const sums = cols.map((_, i) => rows.reduce((a, r) => a + (num(r.quantities?.[i]) ?? 0), 0));
    const okHere = sums.some(x => Math.abs(x - v) < 1e-6);
    // Some invoices total a different unit than any column (e.g. TotalPiezas on a cajas-only table): only
    // count a mismatch when the label names a unit we can compare.
    const comparable = sums.length > 0 && (/PIEZ|PZA|CAJ|CANT|UNID/i.test(t0.label));
    if (okHere) totalsOk = totalsOk ?? true;
    else if (comparable) { totalsOk = false; warnings.push(`Total impreso "${t0.label} ${t0.value}" no cuadra con la suma leída (${sums.join(' / ')}). Revisa renglón por renglón.`); }
  }
  if (totalsOk === false) for (const p of proposals) if (p.status === 'ok') { p.status = 'review'; p.reasons.push('el total de la factura no cuadra'); }
  return { supplier, proposals, totalsOk, warnings };
}
