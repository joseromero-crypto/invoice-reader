import { describe, it, expect } from 'vitest';
import { match, type CatalogItem } from '../lean/match.ts';
import type { Transcription, TranscribedRow } from '../lean/transcribe.ts';

const item = (o: Partial<CatalogItem>): CatalogItem => ({ id: '1', name: 'x', sku: 'S', supplier: 'Arca Continental', supplierSku: '', barcodes: [], purchaseUnit: 'Caja', perPurchaseUnit: 12, ...o });
const row = (o: Partial<TranscribedRow>): TranscribedRow => ({ photo: 1, codes: [], description: '', quantities: [], unit: null, mark: 'check', note: null, ...o });
const doc = (cols: string[], rows: TranscribedRow[], printedTotals: Transcription['printedTotals'] = []): Transcription => ({ supplier: null, documentRef: null, date: null, quantityColumns: cols, printedTotals, rows });

const catalog = [
  item({ id: 'topo', name: 'Agua mineral Topo Chico 600ml', supplierSku: '1152', barcodes: ['7501055300000'], perPurchaseUnit: 12 }),
  item({ id: 'coca', name: 'Refresco Coca Cola Sin Azúcar 2.5L', supplierSku: '2574', perPurchaseUnit: 8 }),
  item({ id: 'activia', name: 'Activia fresa 225g', supplier: 'Danone', supplierSku: '180174', barcodes: ['7501032398071'], purchaseUnit: 'Pieza', perPurchaseUnit: 1 }),
];

describe('lean match', () => {
  it('uses the printed PIEZAS column and cross-checks cajas × catalog pieces', () => {
    const r = match(doc(['CAJAS', 'PIEZAS'], [
      row({ codes: [{ header: 'DESCRIPCION', value: '1152' }, { header: 'CVEPROD', value: '50202310' }], quantities: ['5.000', '60'] }),
      row({ codes: [{ header: 'DESCRIPCION', value: '2574' }], quantities: ['5.000', '38'] }),
    ]), catalog);
    expect(r.supplier).toBe('Arca Continental');
    expect(r.proposals[0]).toMatchObject({ quantity: 60, status: 'ok', matchedBy: 'supplierSku' });
    expect(r.proposals[0].item?.id).toBe('topo');
    expect(r.proposals[1].status).toBe('review'); // 5 × 8 ≠ 38
  });

  it('converts cajas to pieces with the catalog when no piece column exists', () => {
    const r = match(doc(['CANT.'], [row({ codes: [{ header: 'CLAVE', value: '01152' }], quantities: ['3'], unit: 'CAJAS' })]), catalog);
    expect(r.proposals[0]).toMatchObject({ quantity: 36, status: 'ok' });
  });

  it('matches by barcode even when the supplier code changed, and never uses SAT codes', () => {
    const r = match(doc(['CANTIDAD (CAJAS - ZZ)', 'CANTIDAD (CAJAS - EA)'], [
      row({ codes: [{ header: 'CODIGO INTERNO', value: '209973' }, { header: 'CLAVE PROD. SERV.', value: '50131700' }, { header: 'CODIGO DE BARRAS', value: '7501032398071' }], quantities: ['3.00', '3.00'] }),
    ]), catalog);
    expect(r.proposals[0]).toMatchObject({ matchedBy: 'barcode', quantity: 3, status: 'ok' });
  });

  it('excludes crossed rows and sends unclear marks to review', () => {
    const r = match(doc(['PIEZAS'], [
      row({ codes: [{ header: 'CLAVE', value: '1152' }], quantities: ['12'], mark: 'cross' }),
      row({ codes: [{ header: 'CLAVE', value: '1152' }], quantities: ['12'], mark: 'other', note: '8' }),
    ]), catalog);
    expect(r.proposals.map(p => p.status)).toEqual(['excluded', 'review']);
  });

  it('blocks bulk confirm when the printed total does not add up', () => {
    const r = match(doc(['PIEZAS'], [row({ codes: [{ header: 'CLAVE', value: '1152' }], quantities: ['12'] })], [{ label: 'TOTAL PIEZAS', value: '24' }]), catalog);
    expect(r.totalsOk).toBe(false);
    expect(r.proposals[0].status).toBe('review');
  });

  it('suggests candidates but never auto-picks by description', () => {
    const r = match(doc(['PIEZAS'], [row({ codes: [{ header: 'CLAVE', value: 'ZZZ' }], description: 'TOPO CHICO AGUA MINERAL 600ML', quantities: ['12'], unit: 'PZ' })]), catalog);
    expect(r.proposals[0].item).toBeNull();
    expect(r.proposals[0].candidates[0]?.id).toBe('topo');
    expect(r.proposals[0].status).toBe('review');
  });
});
