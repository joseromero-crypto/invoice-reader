import { describe, it, expect } from 'vitest';
import { match, packOf, type CatalogItem } from '../lean/match.ts';
import type { Transcription, TranscribedRow } from '../lean/transcribe.ts';
import { receptionRecord, RECEPTION_CONTRACT } from '../lean/reception.ts';

const item = (o: Partial<CatalogItem>): CatalogItem => ({ id: '1', name: 'x', sku: 'S', supplier: 'Arca Continental', supplierSku: '', barcodes: [], purchaseUnit: 'Caja', perPurchaseUnit: 12, ...o });
const row = (o: Partial<TranscribedRow>): TranscribedRow => ({ photo: 1, codes: [], description: '', quantities: [], unit: null, mark: 'check', note: null, ...o });
const doc = (cols: string[], rows: TranscribedRow[], printedTotals: Transcription['printedTotals'] = []): Transcription => ({ supplier: null, documentRef: null, date: null, quantityColumns: cols, printedTotals, rows });

const catalog = [
  item({ id: 'topo', name: 'Agua mineral Topo Chico 600ml', supplierSku: '1152', barcodes: ['7501055300000'], perPurchaseUnit: 12 }),
  item({ id: 'coca', name: 'Refresco Coca Cola Sin Azúcar 2.5L', supplierSku: '2574', perPurchaseUnit: 8 }),
  item({ id: 'activia', name: 'Activia fresa 225g', supplier: 'Danone', supplierSku: '180174', barcodes: ['7501032398071'], purchaseUnit: 'Pieza', perPurchaseUnit: 1 }),
];

describe('packs', () => {
  it('reads what one Retool unit holds from the Masterview name', () => {
    expect(packOf('Refresco Coca Cola Original 355ml (12-pack)')).toEqual({ n: 12, kind: 'pack' });
    expect(packOf('Leche entera Alpura 1L (4 Pack)')).toEqual({ n: 4, kind: 'pack' });
    expect(packOf('Jabón de barra azul Escudo 110g 3-pack')).toEqual({ n: 3, kind: 'pack' });
    expect(packOf('Pack toallitas desinfectantes Clorox 30pz (4-pack)')).toEqual({ n: 4, kind: 'pack' });
    expect(packOf('Huevo blanco San Juan caja 18pz')).toEqual({ n: 18, kind: 'contenido' });
    expect(packOf('Flan vainilla LALA 100g / 6pz')).toEqual({ n: 6, kind: 'contenido' });
    expect(packOf('Chocolates minis Snickers 8.5g (45pz)')).toEqual({ n: 45, kind: 'contenido' });
    expect(packOf('Avena instantánea Granvita 8 sobres 35g c/u')).toEqual({ n: 8, kind: 'contenido' });
    expect(packOf('Plátano chiapas racimo (5-7 pz)')).toBeNull();
    expect(packOf('Bisquet Nūbe 1pz')).toBeNull();
    expect(packOf('Refresco lata Coca Cola 355ml')).toBeNull();
    expect(packOf('Bolsas de basura grandes Fácil Pack 20pz')).toEqual({ n: 20, kind: 'contenido' });
  });

  const packs = [
    item({ id: 'zbz', name: 'Refresco Coca Cola Original 355ml (12-pack)', supplierSku: '1192', purchaseUnit: 'Pieza', perPurchaseUnit: 1 }),
    item({ id: 'uth', name: 'Refresco original vidrio Coca Cola 235ml (12-pack)', supplierSku: '2442', purchaseUnit: 'Caja', perPurchaseUnit: 1 }),
    item({ id: 'lata', name: 'Refresco lata Coca Cola 355ml', supplierSku: '1190', purchaseUnit: 'Pieza', perPurchaseUnit: 1 }),
    item({ id: 'huevo', name: 'Huevo blanco San Juan caja 18pz', supplierSku: 'H18', purchaseUnit: 'Pieza', perPurchaseUnit: 1 }),
    item({ id: 'flauta', name: 'Flautas de tinga de pollo Chonchi 600g (12pz)', supplierSku: 'FL1', purchaseUnit: 'Caja', perPurchaseUnit: 12 }),
  ];
  const arca = (code: string, q: [string, string]) => row({ codes: [{ header: 'DESCRIPCION', value: code }], quantities: q, unit: 'CAJAS' });

  it('Arca "12 MPK": CAJAS 3 / PIEZAS 36 of a 12-pack is 3 for Retool, and asks a person', () => {
    const r = match(doc(['CAJAS', 'PIEZAS'], [arca('1192', ['3.000', '36']), arca('2442', ['5.000', '60']), arca('1190', ['1.000', '24'])]), packs);
    expect(r.proposals[0]).toMatchObject({ quantity: 3, status: 'review', quantityOk: true });
    expect(r.proposals[0].reasons).toContain('paquete de 12: Retool cuenta 3 paquetes (36 piezas)');
    expect(r.proposals[1]).toMatchObject({ quantity: 5, status: 'review' });
    expect(r.proposals[2]).toMatchObject({ quantity: 24, status: 'ok' }); // single cans: supplier packs are ignored
  });

  it('a pieces-only number on a pack that could be either is unsure', () => {
    const r = match(doc(['PIEZAS'], [row({ codes: [{ header: 'CLAVE', value: '1192' }], quantities: ['36'] })]), packs, new Map(), { mode: 'recepcion' });
    expect(r.proposals[0]).toMatchObject({ quantity: 36, quantityOk: false, confident: true });
    expect(r.proposals[0].reasons).toContain('paquete de 12: ¿36 paquetes o 3 paquetes (36 piezas)?');
  });

  it('contents items convert only on proof, with no question; the catalog factor wins when it explains the numbers', () => {
    const r = match(doc(['CAJAS', 'PIEZAS'], [arca('H18', ['2', '36']), arca('FL1', ['1', '12'])]), packs);
    expect(r.proposals[0]).toMatchObject({ quantity: 2, status: 'ok' });
    expect(r.proposals[1]).toMatchObject({ quantity: 12, status: 'ok' });
  });

  it('the mh-recibo record says how Retool counts it', () => {
    const t = doc(['CAJAS', 'PIEZAS'], [arca('1192', ['3.000', '36']), arca('1190', ['1.000', '24'])]);
    const rec = receptionRecord(t, match(t, packs, new Map(), { mode: 'recepcion' }), packs);
    expect(rec.rows[0]).toMatchObject({ piezas: 3, packKind: 'pack', packSize: 12, retoolUnit: 'paquete', piezasSueltas: 36, quantityOk: true, confident: true });
    expect(rec.rows[1]).toMatchObject({ piezas: 24, packKind: null, retoolUnit: 'pieza', piezasSueltas: null });
  });
});

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

  it("suggests the invoice supplier's own products first, and disabled products last", () => {
    const alp = (o: Partial<CatalogItem>) => item({ supplier: 'Alpura', purchaseUnit: 'Pieza', perPurchaseUnit: 1, ...o });
    const cat = [
      alp({ id: 'leche', name: 'Leche entera Alpura 1L', supplierSku: 'LEUP420' }),
      alp({ id: 'leche2', name: 'Leche light Alpura 1L', supplierSku: 'LEUP421' }),
      alp({ id: 'yog', name: 'Yoghurt bebible de fresa Alpura 220ml', supplierSku: 'YOBP001' }),
      alp({ id: 'v200', name: 'Leche deslactosada chocolate Alpura Vaquitas 200ml', supplierSku: 'LESA825', purchasingOff: true }),
      alp({ id: 'v180', name: 'Leche deslactosada chocolate Alpura Vaquitas 180ml', supplierSku: 'SA80' }),
      item({ id: 'lala', name: 'Yoghurt bebible fresa LALA 220g', supplier: 'LALA', supplierSku: '027784' }),
    ];
    const known = (code: string) => row({ codes: [{ header: 'CODIGO', value: code }], quantities: ['1'], unit: 'PZ' });
    const r = match(doc(['CANT.'], [known('LEUP420'), known('LEUP421'),
      row({ codes: [{ header: 'CODIGO', value: 'YOBP060' }], description: 'YOGHURT BEB FRESA PAST 220G CED', quantities: ['1'], unit: 'PZ' }),
      row({ codes: [{ header: 'CODIGO', value: 'PTELS00029' }], description: 'LECHE DESLACTOSADA CHOCOLATE VAQUITAS', quantities: ['1'], unit: 'PZ' }),
    ]), cat);
    expect(r.supplier).toBe('Alpura');
    expect(r.proposals[2].candidates[0].id).toBe('yog');
    expect(r.proposals[2].candidates.map(c => c.id)).toContain('lala');
    expect(r.proposals[3].candidates.map(c => c.id).slice(0, 2)).toEqual(['v180', 'v200']);
    expect(r.proposals[3].candidates[1].purchasingOff).toBe(true);
    expect(r.proposals[3].item).toBeNull();
  });

  it('treats an unlabeled column as pieces when it adds up to a printed pieces total (Bimbo)', () => {
    const bimbo = [item({ id: 'pan', name: 'Pan blanco Bimbo 620g', supplier: 'Bimbo', barcodes: ['7500810029183'], perPurchaseUnit: 5 }), item({ id: 'arte', name: 'Pan artesano Bimbo 567g', supplier: 'Bimbo', barcodes: ['7501030452553'], perPurchaseUnit: 5 })];
    const rows = [row({ codes: [{ header: 'COD BARRAS', value: '7500810029183' }], quantities: ['30'] }), row({ codes: [{ header: 'COD BARRAS', value: '7501030452553' }], quantities: ['25'] })];
    const r = match(doc(['CANT'], rows, [{ label: 'PIEZAS EN VENTA', value: '55' }]), bimbo);
    expect(r.proposals.map(p => [p.status, p.quantity])).toEqual([['ok', 30], ['ok', 25]]);
    // Without the total it stays a question (30 piezas or 30 cajas?).
    expect(match(doc(['CANT'], rows), bimbo).proposals[0].status).toBe('review');
  });

  it('ignores a short code that only matches unrelated products of other suppliers (Coca-Cola Light "14")', () => {
    const cat = [...catalog, item({ id: 'light', name: 'Refresco lata Coca Cola Light 355ml', supplierSku: '1193' }), item({ id: 'almendra', name: 'Almendra en hojuelas Calii 250g', supplier: 'Aligonza', supplierSku: '14' }), item({ id: 'galleta', name: 'Galletas de avena Liz Bakery 152g', supplier: 'Flor de Liz', supplierSku: '14' })];
    const r = match(doc(['CAJAS', 'PIEZAS'], [
      row({ codes: [{ header: 'DESCRIPCION', value: '1152' }], quantities: ['1', '12'] }),
      row({ codes: [{ header: 'DESCRIPCION', value: '2574' }], quantities: ['1', '8'] }),
      row({ codes: [{ header: 'DESCRIPCION', value: '14' }], description: 'COCA-COLA LIGHT 355 ML NR LAT 24', quantities: ['1', '24'] }),
    ]), cat);
    const p = r.proposals[2];
    expect(p.item).toBeNull();
    expect(p.reasons).not.toContain('clave de proveedor en varios productos');
    expect(p.candidates[0].id).toBe('light');
    expect(p.candidates.map(c => c.id)).not.toContain('almendra');
  });

  describe('city-aware', () => {
    const away = (o: Partial<CatalogItem>, otherCity = 'Saltillo') => item({ otherCity, ...o });
    const arca = doc(['PIEZAS'], [row({ codes: [{ header: 'CLAVE', value: '7777' }], description: 'AGUA MINERAL 600 ML', quantities: ['12'] })]);

    it('offers a product from another city as a labelled candidate, never as the item', () => {
      const r = match(arca, [...catalog, away({ id: 'salt', name: 'Agua mineral local 600ml', supplierSku: '7777' })]);
      const p = r.proposals[0];
      expect(p.item).toBeNull();
      expect(p.status).toBe('review');
      expect(p.candidates[0]).toMatchObject({ id: 'salt', otherCity: 'Saltillo' });
      expect(p.reasons.join()).toContain('Otra ciudad (Saltillo)');
    });

    it('prefers the hub city row of a code over another city', () => {
      const r = match(doc(['PIEZAS'], [row({ codes: [{ header: 'CLAVE', value: '1152' }], description: 'AGUA MINERAL TOPO CHICO 600 ML', quantities: ['12'] })]),
        [...catalog, away({ id: 'salt', name: 'Agua mineral Topo Chico 600ml', supplierSku: '1152' })]);
      expect(r.proposals[0]).toMatchObject({ matchedBy: 'supplierSku', status: 'ok' });
      expect(r.proposals[0].item?.id).toBe('topo');
    });

    it('a saved mapping to a product from another city stays in review', () => {
      const saved = new Map([['ARCA|7777', 'salt']]);
      const t = { ...arca, supplier: 'ARCA' };
      const p = match(t, [...catalog, away({ id: 'salt', name: 'Otro producto', supplier: 'Otro' })], saved).proposals[0];
      expect(p.status).toBe('review');
      expect(p.item).toBeNull();
    });

    it('labels description candidates from another city and finds regional names through aliases', () => {
      const t = doc(['PIEZAS'], [row({ description: 'JITOMATE SALADET AHORRAMAS', quantities: ['3'], unit: 'PZA' })]);
      const r = match(t, [
        item({ id: 'tomate', name: 'Tomate huaje ahorramás', aliases: ['Jitomate saladet ahorramás'] }),
        away({ id: 'solo', name: 'Jitomate saladet orgánico' }, 'CDMX'),
      ]);
      expect(r.proposals[0].item).toBeNull();
      expect(r.proposals[0].candidates[0]).toMatchObject({ id: 'tomate', name: 'Tomate huaje ahorramás' });
      expect(r.proposals[0].candidates[0].otherCity).toBeUndefined();
      const elsewhere = match(t, [item({ id: 'tomate', name: 'Tomate huaje ahorramás' }), away({ id: 'solo', name: 'Jitomate saladet orgánico' }, 'CDMX')]);
      expect(elsewhere.proposals[0].item).toBeNull();
      expect(elsewhere.proposals[0].candidates.find(c => c.id === 'solo')).toMatchObject({ otherCity: 'CDMX' });
    });

    it('does not auto-confirm a barcode Masterview gives to two SKUs, even across cities', () => {
      const t = doc(['PIEZAS'], [row({ codes: [{ header: 'CODIGO DE BARRAS', value: '7501005113373' }], description: 'X', quantities: ['3'] })]);
      const here = item({ id: 'a', name: 'Producto A', barcodes: ['7501005113373'], purchaseUnit: 'Pieza', perPurchaseUnit: 1 });
      const r = match(t, [here, away({ id: 'b', name: 'Producto B', barcodes: ['7501005113373'] }, 'CDMX')]);
      expect(r.proposals[0]).toMatchObject({ matchedBy: 'barcode', status: 'review' });
      expect(r.proposals[0].item?.id).toBe('a');
      expect(r.proposals[0].candidates[0]).toMatchObject({ id: 'b', otherCity: 'CDMX' });
    });

    it('lets the supplier code settle a shared barcode, and the same SKU in another city is not a conflict', () => {
      const code = { header: 'CODIGO DE BARRAS', value: '7501005113373' };
      const here = item({ id: 'a', barcodes: [code.value], supplierSku: '55', purchaseUnit: 'Pieza', perPurchaseUnit: 1 });
      const other = away({ id: 'b', barcodes: [code.value] }, 'CDMX');
      const both = doc(['PIEZAS'], [row({ codes: [code, { header: 'CLAVE', value: '55' }], quantities: ['3'] })]);
      expect(match(both, [here, other]).proposals[0].status).toBe('ok');
      const alone = doc(['PIEZAS'], [row({ codes: [code], quantities: ['3'] })]);
      expect(match(alone, [here, away({ id: 'a', barcodes: [code.value] }, 'CDMX')]).proposals[0].status).toBe('ok');
    });

    it('votes the supplier with the hub city first, then the whole catalog, without widening the code lookup', () => {
      const lines = [row({ codes: [{ header: 'CLAVE', value: '301' }], description: 'REFRESCO 1.25L', quantities: ['24'] }), row({ codes: [{ header: 'CLAVE', value: '302' }], description: 'REFRESCO 2L', quantities: ['24'] })];
      const r = match(doc(['PIEZAS'], lines), [
        item({ id: 'jamon', name: 'Jamón serrano 100g', supplier: 'Otro', supplierSku: '301' }),
        away({ id: 'r1', name: 'Refresco 1.25L', supplier: 'Bebidas Norte', supplierSku: '301' }),
        away({ id: 'r2', name: 'Refresco 2L', supplier: 'Bebidas Norte', supplierSku: '302' }),
      ]);
      expect(r.supplier).toBe('Bebidas Norte');
      expect(r.proposals[0].item).toBeNull();
      expect(r.proposals[0].status).toBe('review');
    });
  });

  describe('reception mode', () => {
    const recepcion = { mode: 'recepcion' } as const;
    const topo = { header: 'CLAVE', value: '1152' };

    it('uses the printed quantity and only notes handwriting', () => {
      const t = doc(['PIEZAS'], [
        row({ codes: [topo], quantities: ['12'], handQuantities: ['8'], mark: 'check' }),
        row({ codes: [topo], quantities: ['24'], handDelta: '-2', mark: 'none' }),
      ]);
      const captura = match(t, catalog).proposals;
      expect(captura.map(p => p.quantity)).toEqual([8, 22]);
      const r = match(t, catalog, new Map(), recepcion).proposals;
      expect(r.map(p => p.quantity)).toEqual([12, 24]);
      expect(r.every(p => p.confident && p.quantityOk && p.status === 'ok')).toBe(true);
      expect(r.every(p => p.reasons.includes('marca a mano en hoja de recepción'))).toBe(true);
    });

    it('ignores page marks: an unticked row among ticks is not a reason', () => {
      const t = doc(['PIEZAS'], [row({ codes: [topo], quantities: ['12'] }), row({ codes: [topo], quantities: ['12'] }), row({ codes: [topo], quantities: ['12'], mark: 'none' })]);
      expect(match(t, catalog).proposals[2].reasons).toContain('sin palomita');
      const p = match(t, catalog, new Map(), recepcion).proposals[2];
      expect(p).toMatchObject({ status: 'ok', reasons: [], confident: true });
    });

    it('keeps a crossed-out row, read as printed, with a note', () => {
      const t = doc(['PIEZAS'], [row({ codes: [topo], quantities: ['12'], mark: 'cross' }), row({ codes: [topo], quantities: ['6'], mark: 'none' })]);
      expect(match(t, catalog).proposals[0].status).toBe('excluded');
      const p = match(t, catalog, new Map(), recepcion).proposals[0];
      expect(p.status).not.toBe('excluded');
      expect(p).toMatchObject({ quantity: 12, confident: true, item: { id: 'topo' } });
      expect(p.reasons[0]).toMatch(/tachado.*como impreso/);
    });

    it('a saved mapping is a candidate, not the product', () => {
      const t = { ...doc(['CANT.'], [row({ codes: [{ header: 'CLAVE', value: 'YOBT910' }], description: 'YOGHURT BAT FRESA 900G', quantities: ['2'], unit: 'CAJAS' })]), supplier: 'ALPURA' };
      const saved = new Map([['ALPURA|YOBT910', 'topo']]);
      const captura = match(t, catalog, saved).proposals[0];
      expect(captura).toMatchObject({ matchedBy: 'mapping', quantity: 24, confident: false });
      const p = match(t, catalog, saved, recepcion).proposals[0];
      expect(p).toMatchObject({ item: null, matchedBy: null, confident: false, quantity: null, quantityOk: false, status: 'review' });
      expect(p.candidates[0]).toMatchObject({ id: 'topo', score: 1 });
    });

    it("another supplier's code and description matches are not confident", () => {
      const cat = [...catalog, item({ id: 'mora', name: 'Yoghurt batido mora Alpura 900g', supplier: 'Alpura', supplierSku: '7001' }), item({ id: 'fresa', name: 'Yoghurt batido fresa Alpura 900g', supplier: 'Alpura', supplierSku: '7002', purchaseUnit: 'Pieza', perPurchaseUnit: 1 })];
      const t = doc(['PIEZAS'], [
        row({ codes: [topo], quantities: ['12'] }), row({ codes: [topo], quantities: ['12'] }),
        row({ codes: [{ header: 'CLAVE', value: '7002' }], description: 'YOGHURT BATIDO FRESA 900G', quantities: ['4'] }),
        row({ codes: [{ header: 'CLAVE', value: 'ZZ9' }], description: 'YOGHURT BATIDO MORA 900G', quantities: ['3'] }),
      ]);
      const [, , other, desc] = match(t, cat, new Map(), recepcion).proposals;
      expect(match(t, cat).supplier).toBe('Arca Continental');
      expect(other).toMatchObject({ item: null, confident: false, quantity: 4 });
      expect(other.candidates[0].id).toBe('fresa');
      expect(desc).toMatchObject({ item: null, confident: false, quantity: 3 });
      expect(desc.candidates[0].id).toBe('mora');
    });

    it('leaves captura exactly as it was', () => {
      const t = doc(['CAJAS', 'PIEZAS'], [row({ codes: [topo], quantities: ['5', '60'], mark: 'cross' }), row({ codes: [topo], quantities: ['1', '12'], handQuantities: [null, '10'] })]);
      expect(match(t, catalog)).toEqual(match(t, catalog, new Map(), { mode: 'captura' }));
    });

    it('builds the record mh-recibo reads', () => {
      const t = doc(['CAJAS', 'PIEZAS'], [
        row({ codes: [topo, { header: 'CVEPROD', value: '50202310' }], description: 'AGUA MINERAL 600ML', quantities: ['5', '60'], mark: 'none' }),
        row({ codes: [{ header: 'CLAVE', value: 'ZZZ' }], description: 'TOPO CHICO AGUA MINERAL 600ML', quantities: ['1', null], unit: 'CAJAS', mark: 'none' }),
      ]);
      const rec = receptionRecord(t, match(t, catalog, new Map(), recepcion), catalog);
      expect(rec.contract).toBe(RECEPTION_CONTRACT);
      expect(rec.rows[0]).toEqual({
        sourceRow: 1, sku: 'S', productName: 'Agua mineral Topo Chico 600ml', matchedBy: 'supplierSku', confident: true, piezas: 60, quantityOk: true,
        printedCodes: [topo, { header: 'CVEPROD', value: '50202310' }], printedDescription: 'AGUA MINERAL 600ML',
        printedQuantities: [{ header: 'CAJAS', value: '5' }, { header: 'PIEZAS', value: '60' }], printedUnit: null, candidates: [], notes: [],
        matchKeys: ['1152', '7501055300000'], packKind: null, packSize: null, retoolUnit: 'pieza', piezasSueltas: null,
      });
      expect(rec.rows[1]).toMatchObject({ sourceRow: 2, sku: null, productName: null, matchedBy: null, confident: false, piezas: null, quantityOk: false });
      expect(rec.rows[1].candidates[0]).toEqual({ sku: 'S', name: 'Agua mineral Topo Chico 600ml', score: expect.any(Number), barcodes: ['7501055300000'], supplierSku: '1152' });
      expect(rec.rows[1].matchKeys).toEqual(['ZZZ']);
      expect(rec.rows[1].notes.length).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
    });
  });
});
