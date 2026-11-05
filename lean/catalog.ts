import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { catalogItem, type CatalogItem } from './match.ts';
import { cityRank, parseMasterviewFile } from '../shared/catalog.ts';

// Load the Retool masterview CSV export (same columns as private/catalog/*.csv).
export function loadCatalogCsv(path: string): CatalogItem[] {
  const rows: Record<string, string>[] = parse(readFileSync(path), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  return rows.map(catalogItem).filter(i => i.id);
}

// A hub with no city (hubs.city is null) matches against this city's rows only: the 4,896 rows the reader always used.
export const MATCH_CITY = 'Monterrey';
// One product and one of its city rows → CatalogItem. Empty values come from the product's base row. Pieces
// describe a unit, so a row that names a different unit than the base row keeps its own (empty) pieces.
export function asCatalogItem(p: any, cityRow: any = p.city_row): CatalogItem {
  const rows: any[] = p.city_rows ?? [cityRow];
  const read = (c: any) => catalogItem({ ...p.raw, ...c.raw, sku: p.sku });
  const own = read(cityRow), base = read(rows.find(c => c.city === p.base_city) ?? cityRow);
  const sameUnit = !own.purchaseUnit || own.purchaseUnit === base.purchaseUnit;
  const aliases = [...new Set(rows.map(c => c.name))].filter(n => n !== cityRow.name);
  return {
    ...own, id: p.id, name: cityRow.name,
    supplier: own.supplier || base.supplier,
    supplierSku: own.supplierSku || base.supplierSku,
    barcodes: own.barcodes.length ? own.barcodes : base.barcodes.length ? base.barcodes : p.barcode ? [p.barcode] : [],
    purchaseUnit: own.purchaseUnit || base.purchaseUnit,
    perPurchaseUnit: own.perPurchaseUnit ?? (sameUnit ? base.perPurchaseUnit : null),
    ...(aliases.length ? { aliases } : {}),
  };
}
// The hub's catalog (read_mv_catalog rows) plus the other cities' rows → one product per SKU with all its city rows.
export function withCityRows(own: any[], others: { product: any; row: any }[]): any[] {
  const bySku = new Map<string, any>(own.map(p => [p.sku, { ...p, city_rows: [p.city_row] }]));
  for (const { product, row } of others) {
    if (!bySku.has(product.sku)) bySku.set(product.sku, { raw: {}, ...product, city_rows: [] });
    bySku.get(product.sku).city_rows.push(row);
  }
  for (const p of bySku.values()) p.city_rows.sort((a: any, b: any) => cityRank(a.city) - cityRank(b.city) || a.city.localeCompare(b.city));
  return [...bySku.values()];
}
// What match() reads for a hub: its city's rows, then every other city's row marked otherCity. No city: the rows as read.
export function cityItems(products: any[], city: string | null): CatalogItem[] {
  if (!city) return products.map(p => asCatalogItem(p));
  return products.flatMap(p => {
    const own = p.city_rows.find((c: any) => c.city === city);
    return [...(own ? [asCatalogItem(p, own)] : []), ...p.city_rows.filter((c: any) => c !== own).map((c: any) => ({ ...asCatalogItem(p, c), otherCity: c.city }))];
  });
}
// The catalog as matching would read it from the database after importing these per-city exports, for a hub in this
// city: whitelisted columns only. Ids stay the base row's Retool ids so the bench can score against its answer key.
export function loadMasterviewCsvs(paths: string[], city = MATCH_CITY): CatalogItem[] {
  const files = paths.map(p => parseMasterviewFile(readFileSync(p, 'utf8'), p)).sort((a, b) => cityRank(a.city!) - cityRank(b.city!));
  for (const f of files) if (f.errors.length) throw Error(f.errors.join(' '));
  if (!files.some(f => f.city === city)) throw Error(`No ${city} file`);
  const products = new Map<string, any>();
  for (const f of files) for (const r of f.rows) {
    if (!products.has(r.sku)) products.set(r.sku, { id: r.retoolId, sku: r.sku, base_city: f.city, raw: r.productRaw, city_rows: [] });
    products.get(r.sku).city_rows.push({ city: f.city, name: r.name, raw: r.cityRaw });
  }
  return cityItems([...products.values()], city);
}
