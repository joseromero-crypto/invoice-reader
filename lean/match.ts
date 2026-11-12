// Lean reader, step 2: deterministic matching + quantity rules. No AI, no cost.
// Input: a Transcription (lean/transcribe.ts) and the Calii catalog.
// Output: one proposal per row with a status the review screen can act on:
//   ok       → exact Masterview match (barcode, or this supplier's SKU), quantity resolved, row ticked (see pageMarks).
//              Bulk-confirmable. Nothing else may be ok: a saved mapping is one person's earlier pick, not Masterview.
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
  aliases?: string[];    // the Item text in other cities, for description candidates
  otherCity?: string;    // this entry is that city's row, not the hub's: a candidate, never auto-selected
  purchasingOff?: boolean; // "Deshabilitar compras" in this city: still matchable by code, last among suggestions
}

export interface Candidate { id: string; name: string; sku: string; score: number; otherCity?: string; purchasingOff?: boolean }

export interface Proposal {
  row: TranscribedRow;
  item: CatalogItem | null;
  matchedBy: 'barcode' | 'supplierSku' | 'mapping' | null;
  candidates: Candidate[];
  quantity: number | null;
  quantityBasis: string;
  status: 'ok' | 'review' | 'excluded';
  reasons: string[];
  gap: string | null;    // why Masterview couldn't answer this row by itself; null = exact match. For the report to commercial.
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
    ...(/^(true|s[ií]|1)$/i.test(clean(r['Deshabilitar compras'])) ? { purchasingOff: true } : {}),
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
// Invoice shorthand → the word the catalog uses (Alpura prints "YOGHURT BAT FRESA", "LECHE DESL").
const SHORTHAND: Record<string, string> = { bat: 'batido', beb: 'bebible', desl: 'deslactosado', deslactosada: 'deslactosado', yog: 'yoghurt', yogurt: 'yoghurt', mant: 'mantequilla', ent: 'entera', crrco: 'carranco' };
function tokens(s: string): Set<string> {
  const t = fold(s)
    .replace(/(\d+(?:[.,]\d+)?)\s*(ml|lt|l|g|gr|grs|kg|oz|pz|pzs)\b/g, (_, n, u) => ` ${String(parseFloat(n.replace(',', '.')))}${u === 'gr' || u === 'grs' ? 'g' : u === 'lt' ? 'l' : u === 'pzs' ? 'pz' : u} `)
    .split(/[^a-z0-9.]+/).filter(w => w.length > 1 && !['de', 'con', 'sin', 'nr', 'pet', 'la', 'el', 'pz'].includes(w));
  return new Set(t.map(w => SHORTHAND[w] ?? w));
}
function similarity(a: Set<string>, b: Set<string>) {
  let hit = 0; for (const w of a) if (b.has(w)) hit += /\d/.test(w) ? 2 : 1; // sizes weigh double
  let tot = 0; for (const w of a) tot += /\d/.test(w) ? 2 : 1;
  return tot ? hit / tot : 0;
}

// Tokenizing 18,000 catalog names took most of a match() call, and a catalog item never changes once read.
const nameTokens = new WeakMap<CatalogItem, Set<string>[]>();

// ---------- quantities ----------
const num = (s: string | null | undefined) => {
  if (s == null) return null; const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null;
};
const isPieceHeader = (h: string) => /PIEZ|PZA|\bPZS?\b|\bEA\b(?!.*CAJ)/i.test(h) && !/CAJ/i.test(h);
const isCaseHeader = (h: string) => /CAJ|\bCJ\b|BULTO|\bCS\b/i.test(h);
const pieceUnit = (u: string | null) => !!u && /^(PZ|PZA|PZAS|PIEZA|PIEZAS|PIEZA\(S\)|EA|H87|UNIDAD|UN|UND)$/i.test(u.trim());
const caseUnit = (u: string | null) => !!u && /CAJ|^CJ$|XBX|^CS$/i.test(u.trim());

// Handwriting rules over printing: a number written by the receiver, or a signed adjustment ("-2"), replaces the
// printed quantity. Printed columns that weren't corrected are dropped so a stale PIEZAS can't win over corrected
// CAJAS. row.quantities stays printed, so the printed totals still check against it.
function handwritten(row: TranscribedRow, printed: (number | null)[]): { vals: (number | null)[]; note: string } | null {
  const written = printed.map((_, i) => num(row.handQuantities?.[i]));
  const delta = num(row.handDelta);
  const changed = written.findIndex((v, i) => v != null && v !== printed[i]);
  const known = printed.flatMap((v, i) => v == null ? [] : [i]);
  if (changed >= 0) {
    const before = printed[changed], after = written[changed]!;
    const off = delta != null && before != null && before + delta !== after ? `, pero la marca ${row.handDelta} da ${before + delta}` : '';
    return { vals: written, note: `corregido a mano: impreso ${before ?? 'vacío'}, escrito ${after}${off}` };
  }
  if (!delta) return null;
  if (known.length !== 1 || printed[known[0]]! + delta < 0) return { vals: printed, note: `marca a mano ${row.handDelta}: ajusta la cantidad` };
  const before = printed[known[0]]!;
  return { vals: printed.map((v, i) => i === known[0] ? before + delta : v), note: `corregido a mano: impreso ${before}, marca ${row.handDelta}` };
}

export function quantity(row: TranscribedRow, cols: string[], item: CatalogItem | null): { q: number | null; basis: string; ok: boolean; note?: string } {
  const printed = cols.map((_, i) => num(row.quantities?.[i]));
  const hand = handwritten(row, printed);
  const q = fromColumns(row, cols, hand?.vals ?? printed, item);
  // A hand-corrected quantity is always read by a person, whatever the conversion says.
  return hand ? { ...q, ok: false, note: q.note ? `${hand.note}; ${q.note}` : hand.note } : q;
}

function fromColumns(row: TranscribedRow, cols: string[], vals: (number | null)[], item: CatalogItem | null): { q: number | null; basis: string; ok: boolean; note?: string } {
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

// ---------- marks ----------
// What a repeated mark looks like in a read: the same highlighter comes back as "code highlighted in yellow" or
// "yellow highlighter on code", and as mark "other" or "none", from one read to the next.
function markKind(row: TranscribedRow): string | null {
  const note = fold(row.note ?? '').trim();
  if (row.mark === 'check' || row.mark === 'cross' || !note || /\d|\bno\b|falt|devuel|rechaz/.test(note)) return null;
  if (/highlight|yellow|marcatexto|resaltad|amarill/.test(note)) return 'highlight';
  if (/dash|line|stroke|guion|raya/.test(note)) return 'dash';
  return note;
}
// A mark repeated down the page says the row was looked at, not that something is wrong with it, so it counts as a
// tick: any mark on every row that isn't crossed out, a dash or highlighter on at least half of them (Cumbres ticks
// LALA with dashes). A page with no marks at all has nothing to compare, so it isn't a reason to stop on every row.
// A page with no ticks and only a stray note or two (Arca DNL 5694665657: one circled "PNS OC" among 22 rows) is still
// an unticked page: the noted rows stop on their own note, the others don't stop for "sin palomita".
function pageMarks(rows: TranscribedRow[]): { neutral: Set<string>; unmarked: boolean; allCrossed: boolean } {
  const open = rows.filter(r => r.mark !== 'cross'), kinds = new Map<string, number>();
  for (const r of open) { const k = markKind(r); if (k) kinds.set(k, (kinds.get(k) ?? 0) + 1); }
  const neutral = [...kinds].filter(([k, n]) => n >= 2 && (n === open.length || (['dash', 'highlight'].includes(k) && n * 2 >= open.length))).map(([k]) => k);
  const marked = open.filter(r => r.mark !== 'none');
  const unmarked = open.length >= 2 && !marked.some(r => r.mark === 'check') && marked.length * 4 <= open.length;
  return { neutral: new Set(neutral), unmarked, allCrossed: rows.length >= 2 && !open.length };
}

// ---------- main ----------
export function match(t: Transcription, catalog: CatalogItem[], mappings: Mappings = new Map()): MatchResult {
  // The hub's city comes first; entries with otherCity are only looked at when the hub's own rows explain nothing.
  const local = catalog.filter(c => !c.otherCity);
  const index = (items: CatalogItem[]) => {
    const barcode = new Map<string, CatalogItem[]>(), sku = new Map<string, CatalogItem[]>();
    for (const it of items) {
      for (const b of it.barcodes) { const k = normCode(b); if (k.length >= 6) barcode.set(k, [...(barcode.get(k) ?? []), it]); }
      const k = normCode(it.supplierSku); if (k) sku.set(k, [...(sku.get(k) ?? []), it]);
    }
    return { barcode, sku };
  };
  const { barcode: byBarcode, sku: skuGlobal } = index(local), everywhere = index(catalog);

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
  const marks = pageMarks(rows);

  // Supplier: the catalog supplier whose barcodes/SKUs explain the most rows (printed legal names often
  // differ from catalog names, e.g. "Comercializadora de Lácteos" = LALA). Fall back to the printed name.
  const vote = (ix: ReturnType<typeof index>) => {
    const votes = new Map<string, number>();
    codes.forEach(c => {
      const hit = new Set<string>();
      for (const b of c.barcodes) for (const it of ix.barcode.get(b) ?? []) hit.add(it.supplier);
      for (const k of c.keys) for (const it of ix.sku.get(k) ?? []) hit.add(it.supplier);
      for (const s of hit) votes.set(s, (votes.get(s) ?? 0) + 1);
    });
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    return ranked[0] && ranked[0][1] >= Math.max(2, rows.length * 0.3) ? ranked[0][0] : null;
  };
  const printedName = (items: CatalogItem[]) => {
    if (!t.supplier) return null;
    const printed = fold(t.supplier);
    const names = [...new Set(items.map(c => c.supplier))].filter(Boolean);
    return names.find(s => fold(s).split(/\s+/).some(w => w.length > 3 && printed.includes(w))) ?? null;
  };
  const supplier = vote({ barcode: byBarcode, sku: skuGlobal }) ?? printedName(local) ?? vote(everywhere) ?? printedName(catalog);
  const pool = supplier ? local.filter(c => c.supplier === supplier) : local;
  const bySku = index(pool).sku;
  const withTokens = (it: CatalogItem) => {
    let names = nameTokens.get(it);
    if (!names) nameTokens.set(it, names = [it.name, ...(it.aliases ?? [])].map(tokens));
    return [it, names] as const;
  };
  const poolTokens = pool.map(withTokens);
  // Description candidates also cover products the hub's city doesn't have, once each.
  const localIds = new Set(local.map(c => c.id));
  const exclusive = [...new Map(catalog.filter(c => !localIds.has(c.id)).reverse().map(c => [c.id, c])).values()];
  const allTokens = supplier || exclusive.length ? [...local, ...exclusive].map(withTokens) : poolTokens;
  const candidate = (c: CatalogItem, score: number): Candidate => ({ id: c.id, name: c.name, sku: c.sku, score, ...(c.otherCity ? { otherCity: c.otherCity } : {}), ...(c.purchasingOff ? { purchasingOff: true } : {}) });
  const distinct = (items: CatalogItem[]) => items.filter((c, k, a) => a.findIndex(x => x.id === c.id) === k);

  const proposals = rows.map((row, i): Proposal => {
    const reasons: string[] = [];
    const { barcodes, keys } = codes[i];
    let item: CatalogItem | null = null, matchedBy: Proposal['matchedBy'] = null;

    const mapSupplier = supplier ?? t.supplier?.trim() ?? '';
    const mappedAway: CatalogItem[] = [];
    let mapped: CatalogItem | null = null;
    for (const k of [...keys, ...barcodes]) {
      const id = mappings.get(`${mapSupplier}|${k}`); if (!id) continue;
      const hit = local.find(c => c.id === id);
      if (hit) { mapped = hit; break; }
      mappedAway.push(...catalog.filter(c => c.id === id));
    }
    const bcHits = [...new Set(barcodes.flatMap(b => byBarcode.get(b) ?? []))];
    let skuHits = [...new Set(keys.flatMap(k => bySku.get(k) ?? []))];
    const desc = tokens(row.description ?? '');
    // Distributors (e.g. Alpura routes) also deliver other brands: fall back to the whole catalog, but only
    // to items whose name resembles the printed description (short codes like "14" repeat across suppliers).
    // A name that merely resembles the description is not an exact match, so these rows are never ok.
    const ownSku = skuHits.length > 0;
    if (!ownSku) skuHits = [...new Set(keys.flatMap(k => skuGlobal.get(k) ?? []))].filter(it => similarity(desc, tokens(it.name)) >= 0.3);
    if (!item && bcHits.length === 1) { item = bcHits[0]; matchedBy = 'barcode'; }
    else if (!item && bcHits.length > 1) reasons.push('código de barras en varios productos del catálogo');
    if (!item && skuHits.length === 1) { item = skuHits[0]; matchedBy = 'supplierSku'; }
    else if (!item && skuHits.length > 1) reasons.push('clave de proveedor en varios productos');
    if (item && matchedBy === 'supplierSku' && !ownSku) reasons.push(`la clave es de otro proveedor en Masterview (${item.supplier}); confirma el producto`);
    // Masterview decides. A saved mapping only fills in the product when Masterview has no answer, and a person checks it.
    if (item && mapped && mapped.id !== item.id) reasons.push(`un mapeo guardado dice otro producto (${mapped.name}); se usó Masterview`);
    if (!item && mapped) { item = mapped; matchedBy = 'mapping'; reasons.push('sin coincidencia en Masterview: producto de un mapeo guardado, verifícalo'); }
    if (item && matchedBy === 'barcode' && skuHits.length && !skuHits.includes(item)) reasons.push(`clave ${keys.join('/')} apunta a otro producto (${skuHits[0].name}); se usó el código de barras`);
    // Masterview gives this barcode to another SKU too (in any city): the barcode alone can't confirm the product.
    const sameBarcode = item && matchedBy === 'barcode' && !skuHits.includes(item)
      ? distinct(barcodes.flatMap(b => everywhere.barcode.get(b) ?? [])).filter(c => c.id !== item!.id) : [];
    if (sameBarcode.length) reasons.push('código de barras de varios SKU en Masterview; confirma el producto');
    // Nothing in the hub's city: codes from other cities only suggest a product, for a person to pick.
    const away = item ? [] : distinct([...mappedAway, ...(bcHits.length || skuHits.length ? [] : [
      ...barcodes.flatMap(b => everywhere.barcode.get(b) ?? []),
      ...keys.flatMap(k => everywhere.sku.get(k) ?? []).filter(it => similarity(desc, tokens(it.name)) >= 0.3),
    ])].filter(c => c.otherCity));
    for (const c of away) reasons.push(`Otra ciudad (${c.otherCity}): el código coincide con ${c.name}`);

    // A product with purchasing switched off in this city is rarely what arrived (Alpura "SABORIZADA 180 ML" was picked
    // as the disabled 200 ml Vaquitas), so it sorts as if it scored 0.3 less.
    const sortKey = (c: Candidate) => c.score - (c.purchasingOff ? 0.3 : 0);
    const rank = (list: (readonly [CatalogItem, Set<string>[]])[]) => list.map(([it, names]) => candidate(it, Math.max(...names.map(tk => similarity(desc, tk)))))
      .filter(c => c.score > 0.25).sort((a, b) => sortKey(b) - sortKey(a)).slice(0, 3);
    // The invoice supplier's own products come first; a weak own match keeps its top two places and the best other
    // suppliers' products fill in (Alpura "YOGHURT BEB FRESA PAST 220G" scored LALA 220g above Alpura 220ml).
    const own = item ? [] : rank(poolTokens);
    let candidates = own;
    if (!item && (own[0]?.score ?? 0) < 0.5) candidates = [...own.slice(0, 2), ...rank(allTokens).filter(c => !own.some(o => o.id === c.id))].slice(0, 3);
    for (const c of bcHits.length > 1 ? bcHits : skuHits.length > 1 ? skuHits : []) candidates.unshift(candidate(c, 1));
    const disputed = mapped && mapped.id !== item?.id ? [mapped] : [];
    candidates = [...away, ...sameBarcode, ...disputed].map(c => candidate(c, 1)).concat(candidates).filter((c, k, a) => a.findIndex(x => x.id === c.id) === k);
    if (!item && !away.length) reasons.push(candidates.length ? 'elegir producto (sin código coincidente)' : 'producto no encontrado en catálogo');

    const exact = matchedBy === 'barcode' || (matchedBy === 'supplierSku' && ownSku);
    const gap = !barcodes.length && !keys.length ? 'Sin código en la factura'
      : bcHits.length > 1 || skuHits.length > 1 ? 'Código en varios productos de Masterview'
      : sameBarcode.length ? 'Código de barras en varios SKU de Masterview'
      : exact ? null
      : matchedBy === 'supplierSku' ? 'Clave de otro proveedor en Masterview'
      : away.length ? 'Solo en Masterview de otra ciudad' : 'No está en Masterview';

    const q = quantity(row, cols, item);
    if (!q.ok) reasons.push(q.note ?? 'confirmar cantidad');

    let status: Proposal['status'];
    const ticked = marks.unmarked || marks.neutral.has(markKind(row) ?? '');
    if (marks.allCrossed) { status = 'review'; reasons.unshift('todos los renglones vienen tachados: confirma qué llegó'); }
    else if (row.mark === 'cross') { status = 'excluded'; reasons.unshift('tachado en la factura'); }
    else {
      if (row.mark === 'none' && !ticked) reasons.push('sin palomita');
      if (row.mark === 'other' && !marks.neutral.has(markKind(row) ?? '') && !/^(corregido|marca) a mano/.test(q.note ?? '')) reasons.push(`marca a mano: ${row.note ?? 'no clara'}`);
      status = reasons.length ? 'review' : 'ok';
    }
    return { row, item, matchedBy, candidates, quantity: q.q, quantityBasis: q.basis, status, reasons, gap };
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
    // Two invoices in one upload each print their own total under the same label: together they must equal the rows.
    const sameLabel = (t.printedTotals ?? []).filter(x => x.label.trim().toUpperCase() === t0.label.trim().toUpperCase());
    const together = sameLabel.length > 1 ? sameLabel.reduce((a, x) => a + (num(x.value) ?? 0), 0) : v;
    const okHere = sums.some(x => Math.abs(x - v) < 1e-6 || Math.abs(x - together) < 1e-6);
    // Some invoices total a different unit than any column (e.g. TotalPiezas on a cajas-only table): only
    // count a mismatch when the label names a unit we can compare.
    const comparable = sums.length > 0 && (/PIEZ|PZA|CAJ|CANT|UNID/i.test(t0.label));
    if (okHere) totalsOk = totalsOk ?? true;
    else if (comparable) { totalsOk = false; warnings.push(`Total impreso "${t0.label} ${t0.value}" no cuadra con la suma leída (${sums.join(' / ')}). Revisa renglón por renglón.`); }
  }
  if (totalsOk === false) for (const p of proposals) if (p.status === 'ok') { p.status = 'review'; p.reasons.push('el total de la factura no cuadra'); }
  return { supplier, proposals, totalsOk, warnings };
}
