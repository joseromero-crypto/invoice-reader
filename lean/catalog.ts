import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { catalogItem, type CatalogItem } from './match.ts';
import { parseMasterviewFile } from '../shared/catalog.ts';

// Load the Retool masterview CSV export (same columns as private/catalog/*.csv).
export function loadCatalogCsv(path: string): CatalogItem[] {
  const rows: Record<string, string>[] = parse(readFileSync(path), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  return rows.map(catalogItem).filter(i => i.id);
}

// The city to match against until city-aware matching: the same 4,896 rows the reader used before the shared catalog.
export const MATCH_CITY = 'Monterrey';
// One read_mv_catalog row (mv_products + its row in MATCH_CITY) → CatalogItem.
export function asCatalogItem(p: any): CatalogItem {
  const c = p.city_row;
  return { ...catalogItem({ ...p.raw, ...c.raw, sku: p.sku }), id: p.id, name: c.name };
}
// The catalog as matching would read it from the database after importing these per-city exports:
// whitelisted columns, MATCH_CITY rows only. Ids stay Retool ids so the bench can score against its answer key.
export function loadMasterviewCsvs(paths: string[]): CatalogItem[] {
  const file = paths.map(p => parseMasterviewFile(readFileSync(p, 'utf8'), p)).find(f => f.city === MATCH_CITY);
  if (!file) throw Error(`No ${MATCH_CITY} file`);
  if (file.errors.length) throw Error(file.errors.join(' '));
  return file.rows.map(r => ({ ...asCatalogItem({ id: r.retoolId, sku: r.sku, raw: r.productRaw, city_row: { name: r.name, raw: r.cityRaw } }) }));
}
