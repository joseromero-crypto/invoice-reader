#!/usr/bin/env -S node --experimental-strip-types
// Phase 3 of unifyMasterview-plan.md: compare each per-city full export with that city's rows in the all-cities lean export.
//   node --experimental-strip-types scripts/mv-compare.ts <all-cities-lean.csv> <city.csv>... [--out report.md]
// Free and read-only. The summary goes to stdout; --out also writes every difference.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parse } from 'csv-parse/sync';

type Row = Record<string, string>;
const SHARED_COLUMNS = ['Item', 'Proveedor', 'Calii Unit', 'Source Unit'];
const EXPECTED: Record<string, number> = { Monterrey: 4896, Saltillo: 4714, CDMX: 4528, Guadalajara: 4474 };
const LIST_LIMIT = 15;

const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const out = outAt >= 0 ? argv.splice(outAt, 2)[1] : null;
const [leanFile, ...cityFiles] = argv;
if (!leanFile || !cityFiles.length) throw Error('Usage: mv-compare.ts <all-cities-lean.csv> <city.csv>... [--out report.md]');

const read = (file: string): Row[] => parse(readFileSync(file, 'utf8'), { columns: true, bom: true, skip_empty_lines: true });
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const value = (s: string | undefined) => { const v = (s ?? '').trim(); return v === '-' || v === "'-" ? '' : v; };
const shown = (list: string[]) => list.length > LIST_LIMIT ? `${list.slice(0, LIST_LIMIT).join(', ')} … (+${list.length - LIST_LIMIT})` : list.join(', ') || '—';

const lean = read(leanFile);
const leanByCity = new Map<string, Row[]>();
for (const r of lean) { const c = fold(r.city ?? ''); (leanByCity.get(c) ?? leanByCity.set(c, []).get(c)!).push(r); }

const summary: string[] = [], detail: string[] = [];
const say = (line = '') => { summary.push(line); detail.push(line); };
say(`# Masterview per-city exports vs ${basename(leanFile)}`);
say();
say(`Lean file: ${lean.length.toLocaleString('en-US')} rows; cities ${[...new Set(lean.map(r => r.city))].join(', ')}.`);
let setsMatch = true;

for (const file of cityFiles) {
  const full = read(file);
  const cities = [...new Set(full.map(r => r.city))];
  const city = cities[0] ?? basename(file);
  const leanRows = leanByCity.get(fold(city)) ?? [];
  const fullBySku = new Map(full.map(r => [r.sku, r])), leanBySku = new Map(leanRows.map(r => [r.sku, r]));
  const onlyFull = [...fullBySku.keys()].filter(s => !leanBySku.has(s)), onlyLean = [...leanBySku.keys()].filter(s => !fullBySku.has(s));
  if (onlyFull.length || onlyLean.length) setsMatch = false;

  const columns = SHARED_COLUMNS.filter(c => full[0] && c in full[0] && leanRows[0] && c in leanRows[0]);
  const differences = columns.map(column => ({
    column,
    rows: [...fullBySku].flatMap(([sku, r]) => {
      const other = leanBySku.get(sku);
      return other && value(r[column]) !== value(other[column]) ? [{ sku, full: value(r[column]), lean: value(other[column]) }] : [];
    }),
  }));

  const noImage = full.filter(r => !value(r['Image URL'])).map(r => r.sku);
  const noBarcode = full.filter(r => !value(r['Código de Barras'])).map(r => r.sku);
  const barcodes = new Map<string, string[]>();
  for (const r of full) { const b = value(r['Código de Barras']); if (b) barcodes.set(b, [...(barcodes.get(b) ?? []), r.sku]); }
  const repeated = [...barcodes].filter(([, skus]) => skus.length > 1);

  say();
  say(`## ${city} (${basename(file)})`);
  if (cities.length !== 1) say(`- **Not a single-city file:** ${cities.join(', ')}`);
  say(`- Rows: full ${full.length.toLocaleString('en-US')}, lean ${leanRows.length.toLocaleString('en-US')}, expected ${EXPECTED[city]?.toLocaleString('en-US') ?? 'n/a'}. Duplicate SKUs in the full file: ${full.length - fullBySku.size}.`);
  say(`- SKUs only in the full file: ${onlyFull.length} (${shown(onlyFull)})`);
  say(`- SKUs only in the lean file: ${onlyLean.length} (${shown(onlyLean)})`);
  for (const d of differences) {
    summary.push(`- \`${d.column}\` differs on ${d.rows.length} SKUs${d.rows.length ? `, e.g. ${d.rows.slice(0, 3).map(x => `${x.sku}: "${x.full}" vs "${x.lean}"`).join('; ')}` : ''}`);
    detail.push(`- \`${d.column}\` differs on ${d.rows.length} SKUs`, ...d.rows.map(x => `  - ${x.sku}: full "${x.full}", lean "${x.lean}"`));
  }
  say(`- No \`Image URL\`: ${noImage.length} (${shown(noImage)})`);
  say(`- No \`Código de Barras\`: ${noBarcode.length}`);
  summary.push(`- Barcodes repeated inside the city: ${repeated.length}${repeated.length ? ` (${shown(repeated.map(([b, skus]) => `${b}: ${skus.join('+')}`))})` : ''}`);
  detail.push(`- Barcodes repeated inside the city: ${repeated.length}`, ...repeated.map(([b, skus]) => `  - ${b}: ${skus.join(', ')}`));
  detail.push(`- SKUs with no barcode: ${noBarcode.join(', ') || '—'}`);
}

say();
say(setsMatch ? '**SKU sets match in every city.**' : '**SKU sets differ: review the lists above.**');
console.log(summary.join('\n'));
if (out) writeFileSync(out, detail.join('\n') + '\n');
