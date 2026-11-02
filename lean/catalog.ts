import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import type { CatalogItem } from './match.ts';

const clean = (v: unknown) => { const s = String(v ?? '').trim(); return s === '-' || s === "'-" ? '' : s; };

// Load the Retool masterview CSV export (same columns as private/catalog/*.csv).
export function loadCatalogCsv(path: string): CatalogItem[] {
  const rows: Record<string, string>[] = parse(readFileSync(path), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  return rows.map(r => {
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
  }).filter(i => i.id);
}
