// What Masterview couldn't answer in the saved reads, per supplier, for commercial to fix at the source. Recomputed
// with the current catalog every time, so a code drops off the list once Masterview has it. No AI, no cost.
import { csvCell } from '../shared/domain.ts';
import { match, normCode, rowCodes, type CatalogItem, type Mappings } from './match.ts';
import type { Transcription, TranscribedRow } from './transcribe.ts';

export interface SavedRead { transcription: Transcription; city: string; hub: string; at: string }
export interface UnmatchedRow {
  supplier: string; city: string; code: string; barcode: string; description: string; reason: string;
  invoices: number; lastSeen: string; hubs: string[];
  chosen: { name: string; sku: string } | null;      // picked by a person at a hub: most likely the right SKU to fix
  suggestion: { name: string; sku: string } | null;  // description guess, nobody confirmed it
}

// Codes exactly as printed, symbols and leading zeros included, so commercial can quote them to the supplier (*796).
// Fiscal codes left out.
function printedCodes(row: TranscribedRow) {
  const { keys, barcodes } = rowCodes(row), code: string[] = [], barcode: string[] = [];
  for (const c of row.codes ?? []) {
    const n = normCode(c.value), value = c.value.trim();
    const list = barcodes.includes(n) && (!keys.includes(n) || /^\d{12,14}$/.test(n)) ? barcode : keys.includes(n) ? code : null;
    if (list && !list.includes(value)) list.push(value);
  }
  return { code: code.join(' / '), barcode: barcode.join(' / ') };
}

// reads: newest first. itemsFor: the catalog as match() sees it for a hub in that city.
export function unmatched(reads: SavedRead[], itemsFor: (city: string) => CatalogItem[], mappings: Mappings): UnmatchedRow[] {
  const found = new Map<string, UnmatchedRow & { refs: Set<string> }>(), seen = new Set<string>();
  reads.forEach((read, n) => {
    const t = read.transcription, result = match(t, itemsFor(read.city), mappings);
    const supplier = result.supplier ?? t.supplier?.trim() ?? 'Proveedor sin identificar';
    const ref = t.documentRef?.trim() || `sin-folio-${n}`, invoice = `${supplier}|${ref}`;
    if (seen.has(invoice)) return; // the same invoice read again (retries, test uploads) counts once
    seen.add(invoice);
    for (const p of result.proposals) {
      if (!p.gap) continue;
      const { code, barcode } = printedCodes(p.row), description = p.row.description ?? '';
      const key = `${read.city}|${supplier}|${code || barcode || description.toLowerCase()}`;
      const row = found.get(key) ?? { supplier, city: read.city, code, barcode, description, reason: p.gap, invoices: 0, lastSeen: read.at, hubs: [], chosen: null, suggestion: null, refs: new Set<string>() };
      row.refs.add(ref); row.invoices = row.refs.size;
      if (!row.hubs.includes(read.hub)) row.hubs.push(read.hub);
      if (p.matchedBy === 'mapping' && p.item) row.chosen ??= { name: p.item.name, sku: p.item.sku };
      const guess = p.candidates[0];
      if (guess) row.suggestion ??= { name: guess.name, sku: guess.sku };
      found.set(key, row);
    }
  });
  return [...found.values()].map(({ refs, ...row }) => row)
    .sort((a, b) => a.supplier.localeCompare(b.supplier) || a.city.localeCompare(b.city) || b.invoices - a.invoices || a.code.localeCompare(b.code));
}

// One table for both downloads: header row first, every value as text.
export function unmatchedTable(rows: UnmatchedRow[]): string[][] {
  const headers = ['Proveedor', 'Ciudad', 'Clave proveedor', 'Código de barras', 'Descripción en factura', 'Motivo', 'Facturas', 'Última vez', 'Hubs', 'Artículo elegido en recibo', 'SKU Calii elegido', 'Sugerencia sin confirmar', 'SKU sugerido'];
  return [headers, ...rows.map(r => [r.supplier, r.city, r.code, r.barcode, r.description, r.reason, String(r.invoices), r.lastSeen.slice(0, 10), r.hubs.join(' / '), r.chosen?.name ?? '', r.chosen?.sku ?? '', r.suggestion?.name ?? '', r.suggestion?.sku ?? ''])];
}
export const UNMATCHED_SHEET = { sheet: 'Sin coincidencia', widths: [20, 12, 16, 17, 38, 28, 9, 12, 22, 44, 14, 40, 13], numbers: [6] };
export function unmatchedCsv(rows: UnmatchedRow[]) {
  return '\uFEFF' + unmatchedTable(rows).map(line => line.map(csvCell).join(',')).join('\r\n');
}
