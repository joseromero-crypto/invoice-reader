// The per-row record mh-recibo reads for a reception read (purpose = 'recepcion'), through public.reception_reads().
// It is a contract with another app: add fields if needed, never rename or drop one without bumping RECEPTION_CONTRACT.
// sku is given only when the read is sure of the product (an exact Masterview code: barcode, or this supplier's SKU).
// Everything else (saved mappings, other suppliers' codes, description matches) is sku null with candidates.
// Codes (matchKeys, candidates[].barcodes / supplierSku) are normalized: uppercase, keep only 0-9A-Z, and strip leading
// zeros from all-digit codes (normCode in lean/match.ts). mh-recibo links a row to an OC line when normCode(codigo) or
// normCode(sku_marca) is in matchKeys. Fiscal codes (CVEPROD / Clave Prod. Serv. / 5xxxxxxx) are never in matchKeys.

import { normCode, rowCodes, type CatalogItem, type MatchResult } from './match.ts';
import type { Transcription } from './transcribe.ts';

export const RECEPTION_CONTRACT = 1;

export interface ReceptionRow {
  sourceRow: number;                                   // 1-based printed order
  sku: string | null;                                  // Calii SKU, only when confident
  productName: string | null;                          // Masterview Item in the hub's city, only when confident
  matchedBy: 'barcode' | 'supplierSku' | null;
  confident: boolean;
  piezas: number | null;                               // pieces, from the printed numbers only
  quantityOk: boolean;                                 // false: piezas is null or needs a person (e.g. cajas with no product)
  printedCodes: { header: string; value: string }[];
  printedDescription: string;
  printedQuantities: { header: string; value: string | null }[];
  printedUnit: string | null;
  candidates: { sku: string; name: string; score: number; barcodes: string[]; supplierSku: string | null }[];
  notes: string[];                                     // Spanish, one per reason
  matchKeys: string[];                                 // printed non-fiscal codes + the confident product's Masterview barcodes and SKU Proveedor, normalized
}

const codesOf = (it: CatalogItem | undefined) => ({
  barcodes: [...new Set((it?.barcodes ?? []).map(normCode).filter(Boolean))],
  supplierSku: it?.supplierSku ? normCode(it.supplierSku) || null : null,
});

// catalog: the items match() ran with, so candidates can carry their Masterview codes (empty when not given).
export function receptionRows(t: Transcription, result: MatchResult, catalog: CatalogItem[] = []): ReceptionRow[] {
  const cols = t.quantityColumns ?? [];
  const byId = new Map<string, CatalogItem[]>();
  for (const it of catalog) byId.set(it.id, [...(byId.get(it.id) ?? []), it]);
  const itemOf = (id: string, otherCity?: string) => { const all = byId.get(id) ?? []; return all.find(it => it.otherCity === otherCity) ?? all[0]; };
  return result.proposals.map((p, i) => {
    const sure = p.confident && !!p.item;
    const printed = rowCodes(p.row), own = sure ? codesOf(p.item!) : null;
    const matchKeys = [...new Set([...printed.keys, ...printed.barcodes, ...(own?.barcodes ?? []), ...(own?.supplierSku ? [own.supplierSku] : [])])];
    return {
      sourceRow: i + 1,
      sku: sure ? p.item!.sku : null,
      productName: sure ? p.item!.name : null,
      matchedBy: sure && (p.matchedBy === 'barcode' || p.matchedBy === 'supplierSku') ? p.matchedBy : null,
      confident: sure,
      piezas: p.quantity,
      quantityOk: p.quantityOk,
      printedCodes: (p.row.codes ?? []).map(c => ({ header: c.header, value: c.value })),
      printedDescription: p.row.description ?? '',
      printedQuantities: cols.map((header, k) => ({ header, value: p.row.quantities?.[k] ?? null })),
      printedUnit: p.row.unit ?? null,
      candidates: p.candidates.map(c => ({ sku: c.sku, name: c.name, score: Math.round(c.score * 100) / 100, ...codesOf(itemOf(c.id, c.otherCity)) })),
      notes: [...p.reasons],
      matchKeys,
    };
  });
}

// Saved in extraction_jobs.raw_result.reception by the worker.
export const receptionRecord = (t: Transcription, result: MatchResult, catalog: CatalogItem[] = []) => ({ contract: RECEPTION_CONTRACT, rows: receptionRows(t, result, catalog) });
