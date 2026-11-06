import { describe, it, expect } from 'vitest';
import { match, quantity, type CatalogItem } from '../lean/match.ts';
import type { Transcription, TranscribedRow } from '../lean/transcribe.ts';

const item = (o: Partial<CatalogItem>): CatalogItem => ({ id: 'a', name: 'Agua mineral 600ml', sku: 'S', supplier: 'Arca Continental', supplierSku: '1152', barcodes: [], purchaseUnit: 'Pieza', perPurchaseUnit: 1, ...o });
const row = (o: Partial<TranscribedRow>): TranscribedRow => ({ photo: 1, codes: [{ header: 'CLAVE', value: '1152' }], description: 'AGUA MINERAL 600 ML', quantities: ['10'], unit: 'PZ', mark: 'check', note: null, ...o });
const doc = (rows: TranscribedRow[], cols = ['CANT.'], printedTotals: Transcription['printedTotals'] = []): Transcription => ({ supplier: 'Arca', documentRef: null, date: null, quantityColumns: cols, printedTotals, rows });
const catalog = [item({})];
const statuses = (t: Transcription) => match(t, catalog).proposals.map(p => p.status);

describe('handwriting rules over printing', () => {
  it('a written number replaces the printed one and a person reads it', () => {
    const p = match(doc([row({ handQuantities: ['8'] }), row({})]), catalog).proposals;
    expect(p[0]).toMatchObject({ quantity: 8, status: 'review' });
    expect(p[0].reasons.join()).toContain('impreso 10, escrito 8');
    expect(p[1]).toMatchObject({ quantity: 10, status: 'ok' });
  });

  it('a signed adjustment beside the code changes the printed quantity', () => {
    const [p] = match(doc([row({ handDelta: '-2' })]), catalog).proposals;
    expect(p).toMatchObject({ quantity: 8, status: 'review' });
    expect(p.reasons.join()).toContain('marca -2');
  });

  it('says so when the written number and the adjustment disagree', () => {
    const [p] = match(doc([row({ quantities: ['5'], handQuantities: ['9'], handDelta: '-1' })]), catalog).proposals;
    expect(p.quantity).toBe(9);
    expect(p.reasons.join()).toContain('la marca -1 da 4');
  });

  it('corrected cajas convert with the catalog instead of keeping the printed piezas', () => {
    const box = item({ purchaseUnit: 'Caja', perPurchaseUnit: 12 });
    const q = quantity(row({ quantities: ['5', '60'], handQuantities: ['4', null] }), ['CAJAS', 'PIEZAS'], box);
    expect(q).toMatchObject({ q: 48, ok: false });
  });

  it('does not guess which column an adjustment belongs to', () => {
    const q = quantity(row({ quantities: ['5', '60'], handDelta: '-2' }), ['CAJAS', 'PIEZAS'], item({ purchaseUnit: 'Caja', perPurchaseUnit: 12 }));
    expect(q).toMatchObject({ q: 60, ok: false });
    expect(q.note).toContain('-2');
  });

  it('a written number equal to the printed one changes nothing', () => {
    expect(match(doc([row({ handQuantities: ['10'] })]), catalog).proposals[0]).toMatchObject({ quantity: 10, status: 'ok' });
  });

  it('printed totals still check against the printed numbers', () => {
    const r = match(doc([row({ handQuantities: ['8'] }), row({})], ['CANT.'], [{ label: 'TOTAL PIEZAS', value: '20' }]), catalog);
    expect(r.totalsOk).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('reads saved before the new fields keep working', () => {
    expect(match(doc([row({ mark: 'other', note: 'handwritten 8; dash mark' })]), catalog).proposals[0]).toMatchObject({ quantity: 10, status: 'review' });
  });
});

describe('marks repeated down the page', () => {
  const yellow = (note: string, mark: TranscribedRow['mark'] = 'other') => row({ mark, note });

  it('the same highlighter on every row means nothing, however the read words it', () => {
    expect(statuses(doc([yellow('code highlighted in yellow'), yellow('yellow highlighter on code'), yellow('yellow highlighter line over code')]))).toEqual(['ok', 'ok', 'ok']);
    expect(statuses(doc([yellow('code highlighted in yellow', 'none'), yellow('code highlighted in yellow', 'none')]))).toEqual(['ok', 'ok']);
  });

  it('dashes count as ticks next to real ticks, and an X still excludes its row', () => {
    const rows = [...Array(4)].map(() => yellow('dash mark'));
    expect(statuses(doc([...rows, row({}), row({ mark: 'cross' })]))).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'excluded']);
  });

  it('a page with no marks does not stop on every row', () => {
    expect(statuses(doc([row({ mark: 'none' }), row({ mark: 'none' })]))).toEqual(['ok', 'ok']);
  });

  it('crossed rows plus unmarked rows: the unmarked ones arrived', () => {
    expect(statuses(doc([row({ mark: 'none' }), row({ mark: 'none' }), row({ mark: 'cross' })]))).toEqual(['ok', 'ok', 'excluded']);
  });

  it('a row left unticked among ticks still stops', () => {
    expect(statuses(doc([row({}), row({}), row({ mark: 'none' })]))).toEqual(['ok', 'ok', 'review']);
  });

  it('one odd mark among ticks still stops', () => {
    expect(statuses(doc([row({}), row({}), row({}), yellow('dash mark'), yellow('circled')]))).toEqual(['ok', 'ok', 'ok', 'review', 'review']);
  });

  it('a written NO is never a page style', () => {
    expect(statuses(doc([yellow('handwritten NO'), yellow('handwritten NO')]))).toEqual(['review', 'review']);
  });

  it('every row crossed out is a question, not an empty receipt', () => {
    const p = match(doc([row({ mark: 'cross' }), row({ mark: 'cross' })]), catalog).proposals;
    expect(p.map(x => x.status)).toEqual(['review', 'review']);
    expect(p[0].reasons[0]).toContain('todos los renglones');
  });
});

describe('only an exact Masterview match can be ok', () => {
  const alpura = (o: Partial<CatalogItem>) => item({ supplier: 'Alpura', ...o });
  const items = [alpura({ id: 'leche', name: 'Leche entera Alpura 1L', supplierSku: 'LEUP420' }), alpura({ id: 'pack', name: 'Leche entera Alpura 1L (4 Pack)', supplierSku: 'LEUP550' }), alpura({ id: 'yog', name: 'Yoghurt natural Alpura 900g', supplierSku: 'YONA010' })];
  const code = (value: string, description = 'LECHE ENTERA 1L') => row({ codes: [{ header: 'CLAVE', value }], description });
  const invoice = (...rows: TranscribedRow[]) => ({ ...doc([code('LEUP420'), code('YONA010', 'YOGHURT NATURAL 900G'), ...rows]), supplier: 'Alpura' });

  it('a saved mapping fills in the product but a person confirms it', () => {
    const p = match(invoice(code('LEUP441')), items, new Map([['Alpura|LEUP441', 'pack']])).proposals[2];
    expect(p).toMatchObject({ status: 'review', matchedBy: 'mapping' });
    expect(p.item?.id).toBe('pack');
    expect(p.reasons.join()).toContain('mapeo guardado');
  });

  it('a wrong mapping never beats Masterview, and the disagreement is shown', () => {
    const p = match(invoice(), items, new Map([['Alpura|LEUP420', 'pack']])).proposals[0];
    expect(p).toMatchObject({ status: 'review', matchedBy: 'supplierSku' });
    expect(p.item?.id).toBe('leche');
    expect(p.reasons.join()).toContain('Leche entera Alpura 1L (4 Pack)');
    expect(p.candidates.map(c => c.id)).toContain('pack');
  });

  it('a mapping that agrees with Masterview changes nothing', () => {
    expect(match(invoice(), items, new Map([['Alpura|LEUP420', 'leche']])).proposals[0]).toMatchObject({ status: 'ok', matchedBy: 'supplierSku' });
  });

  it("another supplier's code with a similar name is a suggestion, not a match", () => {
    const other = item({ id: 'otra', name: 'Crema entera 200ml', supplier: 'LALA', supplierSku: 'CR1' });
    const p = match(invoice(code('CR1', 'CREMA ENTERA 200ML')), [...items, other]).proposals[2];
    expect(p.status).toBe('review');
    expect(p.item?.id).toBe('otra');
    expect(p.reasons.join()).toContain('otro proveedor');
  });
});

describe('two invoices in one upload', () => {
  const total = (label: string, value: string) => ({ label, value });
  const rows = [row({ quantities: ['200'] }), row({ quantities: ['28'] })];

  it('their printed totals add up to the rows read', () => {
    const r = match(doc(rows, ['CANT.'], [total('TOTAL EN PIEZAS', '214'), total('TOTAL EN PIEZAS', '14')]), catalog);
    expect(r).toMatchObject({ totalsOk: true, warnings: [] });
    expect(r.proposals.map(p => p.status)).toEqual(['ok', 'ok']);
  });

  it('a row misread or missing still blocks bulk confirm', () => {
    const r = match(doc(rows, ['CANT.'], [total('TOTAL EN PIEZAS', '214'), total('TOTAL EN PIEZAS', '15')]), catalog);
    expect(r.totalsOk).toBe(false);
    expect(r.proposals.map(p => p.status)).toEqual(['review', 'review']);
  });

  it('totals with different labels are never added together', () => {
    expect(match(doc(rows, ['CANT.'], [total('TOTAL PIEZAS', '214'), total('TOTAL CAJAS', '14')]), catalog).totalsOk).toBe(false);
  });
});
