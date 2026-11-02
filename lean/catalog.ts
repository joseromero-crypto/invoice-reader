import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { catalogItem, type CatalogItem } from './match.ts';

// Load the Retool masterview CSV export (same columns as private/catalog/*.csv).
export function loadCatalogCsv(path: string): CatalogItem[] {
  const rows: Record<string, string>[] = parse(readFileSync(path), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  return rows.map(catalogItem).filter(i => i.id);
}
