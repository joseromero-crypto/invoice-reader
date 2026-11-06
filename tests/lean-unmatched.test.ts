import { describe, it, expect } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { UNMATCHED_SHEET, unmatched, unmatchedCsv, unmatchedTable, type SavedRead } from '../lean/unmatched.ts';
import { xlsx } from '../src/lib/xlsx.ts';
import type { CatalogItem } from '../lean/match.ts';
import type { TranscribedRow } from '../lean/transcribe.ts';

const item = (o: Partial<CatalogItem>): CatalogItem => ({ id: 'a', name: 'Leche entera Alpura 1L', sku: 'ABC123', supplier: 'Alpura', supplierSku: 'LEUP420', barcodes: ['7501055900039'], purchaseUnit: 'Pieza', perPurchaseUnit: 1, ...o });
const catalog = [item({}), item({ id: 'y', name: 'Yoghurt natural Alpura 900g', sku: 'YOG900', supplierSku: 'YONA010', barcodes: [] }), item({ id: 'p', name: 'Leche entera Alpura 1L (4 Pack)', sku: 'PACK4', supplierSku: 'LEUP550', barcodes: [] })];
const row = (value: string, description: string, o: Partial<TranscribedRow> = {}): TranscribedRow => ({ photo: 1, codes: value ? [{ header: 'CLAVE', value }] : [], description, quantities: ['1'], unit: 'PZ', mark: 'check', note: null, ...o });
const read = (ref: string | null, rows: TranscribedRow[], o: Partial<SavedRead> = {}): SavedRead => ({ transcription: { supplier: 'GANADEROS', documentRef: ref, date: null, quantityColumns: ['CANT.'], printedTotals: [], rows: [row('LEUP420', 'LECHE'), row('YONA010', 'YOGHURT'), ...rows] }, city: 'Monterrey', hub: 'MH Cumbres', at: '2026-11-06T10:00:00Z', ...o });
const report = (reads: SavedRead[], maps = new Map<string, string>()) => unmatched(reads, () => catalog, maps);

describe('unmatched report', () => {
  it('lists what Masterview could not answer, not what it matched', () => {
    const rows = report([read('A', [row('YOGR020', 'YOGHURT GRIEGO')])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ supplier: 'Alpura', city: 'Monterrey', code: 'YOGR020', reason: 'No está en Masterview', invoices: 1, chosen: null });
  });

  it('a code with a saved mapping stays on the list, with the SKU a person chose', () => {
    const [r] = report([read('A', [row('LEUP441', 'LECHE PQ')])], new Map([['Alpura|LEUP441', 'p']]));
    expect(r).toMatchObject({ code: 'LEUP441', chosen: { name: 'Leche entera Alpura 1L (4 Pack)', sku: 'PACK4' } });
  });

  it('drops off the list once Masterview has the code', () => {
    const rows = unmatched([read('A', [row('LEUP441', 'LECHE PQ')])], () => [...catalog, item({ id: 'n', sku: 'NEW', supplierSku: 'LEUP441', barcodes: [] })], new Map());
    expect(rows).toEqual([]);
  });

  it('counts an invoice once when it was read several times, and adds up different invoices', () => {
    const r = report([read('A', [row('X1', 'COSA')]), read('A', [row('X1', 'COSA')]), read('B', [row('X1', 'COSA')], { hub: 'MH Contry' })]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ invoices: 2, hubs: ['MH Cumbres', 'MH Contry'] });
  });

  it('keeps cities apart, because Masterview is fixed per city', () => {
    expect(report([read('A', [row('X1', 'COSA')]), read('B', [row('X1', 'COSA')], { city: 'Saltillo' })]).map(r => r.city)).toEqual(['Monterrey', 'Saltillo']);
  });

  it('a row with no code is reported by its description', () => {
    expect(report([read('A', [row('', 'PRODUCTO SIN CLAVE')])])[0]).toMatchObject({ code: '', description: 'PRODUCTO SIN CLAVE', reason: 'Sin código en la factura' });
  });

  it('shows a code with its printed symbols', () => {
    expect(report([read('A', [row('*796', 'CIEL AGUA')])])[0].code).toBe('*796');
  });

  it('keeps printed codes as printed and leaves fiscal codes out', () => {
    const r = report([read('A', [row('027784', 'COSA', { codes: [{ header: 'CLAVE', value: '027784' }, { header: 'COD. BARRAS', value: '0750100000001' }, { header: 'CVEPROD', value: '50131700' }] })])])[0];
    expect(r).toMatchObject({ code: '027784', barcode: '0750100000001' });
  });

  it('the CSV shows plain codes and neutralizes formulas from the invoice', () => {
    const csv = unmatchedCsv(report([read('A', [row('027784', '=HYPERLINK("x")')])]));
    expect(csv.startsWith('﻿"Proveedor"')).toBe(true);
    expect(csv).toContain(',"027784",');
    expect(csv).not.toContain('=""');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('the Excel file stores codes as text, exactly as printed, and escapes the invoice text', () => {
    const sheet = (rows: string[][]) => strFromU8(unzipSync(xlsx(rows, UNMATCHED_SHEET))['xl/worksheets/sheet1.xml']);
    const body = sheet(unmatchedTable(report([read('A', [row('027784', 'A & B <C>', { codes: [{ header: 'CLAVE', value: '027784' }, { header: 'COD. BARRAS', value: '7501055900000' }] }), row('*796', 'CIEL')])])));
    expect(body).toContain('t="inlineStr"><is><t xml:space="preserve">027784</t>');
    expect(body).toContain('t="inlineStr"><is><t xml:space="preserve">7501055900000</t>');
    expect(body).toContain('>*796<');
    expect(body).toContain('A &amp; B &lt;C&gt;');
    expect(body).toMatch(/<c r="G2"><v>1<\/v><\/c>/); // Facturas is a real number, so it can be summed
  });
});
