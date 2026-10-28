import {describe,it,expect} from 'vitest';
import {convertQuantity,ExtractionSchema,type Product} from '../shared/domain';
import {supplierKey,matchProducts} from '../shared/matching';
import {buildInvoiceRows} from '../server/match-extraction';
import {invoiceOutputEvidence,invoiceRequestOptions,readInvoiceOutput} from '../server/invoice-output';
const product=(changes:Partial<Product>={}):Product=>({id:'001',sku:'EXAMPLE',name:'Crema 250g',supplier:'Alpura',supplierSku:'00001',barcode:'1234567890123',unit:'pz',...changes});
describe('acceptance failure regressions',()=>{
 it('counts literal piece spellings without treating packages, cases or unknown units as pieces',()=>{
 for(const unit of ['PIEZA(S)','PZA','PZAS',' pz ','Pz.'])expect(convertQuantity(3,unit,'pz')).toEqual({quantity:3,flag:null});
 for(const unit of ['PQ','PAQUETE','CAJAS',null])expect(convertQuantity(3,unit,'pz').quantity).toBeNull();
 expect(convertQuantity(2,'kg','pz').quantity).toBeNull();
 });
 it('recognizes verified legal identities without changing supplier codes or broad supplier matching',()=>{
 for(const [legal,trade] of [['GANADEROS PRODUCTORES DE LECHE PURA S.A.P.I DE C.V','Alpura'],['DISTRIBUIDORA ARCA CONTINENTAL','Arca Continental'],['SIGMA ALIMENTOS COMERCIAL, S.A. DE C.V.','Sigma eCommerce'],['QUALTIA ALIMENTOS OPERACIONES, S. DE R.L. DE C.V.','Qualtia'],['MISSION FOODS MEXICO','Mission Foods']])expect(supplierKey(legal,'00001')).toBe(supplierKey(trade,'00001'));
 expect(supplierKey('Unrelated dairy','00001')).not.toBe(supplierKey('Alpura','00001'));
 expect(supplierKey('Alpura','00001')).not.toBe(supplierKey('Alpura','1'));
 });
 it('keeps a compact printed size conflict pending even with an exact barcode and a reception mark',()=>{
 const raw=ExtractionSchema.parse({supplier:'Alpura',reference:'SYNTHETIC',date:null,currency:null,printedPage:null,printedPageCount:null,printedTotal:null,warnings:[],rows:[{sourcePage:1,sourceRow:1,supplierSku:null,barcode:'1234567890123',description:'Crema252gNC',quantity:3,unit:'PIEZA(S)',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:'Crema252gNC 3 PIEZA(S)',receptionMarked:true,flags:[]}]});
 const before=JSON.stringify(raw);const [row]=buildInvoiceRows(raw,[product()]);expect(row.flags).toContain('Presentación o contenido distinto');expect(row.confirmed).toBe(false);expect(row.proposedQuantity).toBe(3);expect(JSON.stringify(raw)).toBe(before);
 expect(matchProducts({supplier:'Alpura',supplierSku:null,barcode:'1234567890123',description:'Crema250g5'},[product()])[0].flags).not.toContain('Presentación o contenido distinto');
 });
 it('does not approve an unrelated supplier description candidate under a known supplier identity',()=>{
 const candidates=matchProducts({supplier:'GANADEROS PRODUCTORES DE LECHE PURA S.A.P.I DE C.V',supplierSku:'00002',barcode:null,description:'Crema 250g'},[product({name:'Leche 1L'}),product({id:'002',supplier:'Other dairy',supplierSku:'00002'})]);
 expect(candidates[0].flags).toContain('Proveedor de catálogo distinto; requiere verificar');
 });
 it('keeps unresolved supplier-key versions pending even with a compatible description and a check',()=>{
 const raw=ExtractionSchema.parse({supplier:'Alpura',reference:'SYNTHETIC',date:null,currency:null,printedPage:null,printedPageCount:null,printedTotal:null,warnings:[],rows:[{sourcePage:1,sourceRow:1,supplierSku:'00002',barcode:null,description:'Crema 250g',quantity:3,unit:'PZ',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:'00002 Crema 250g 3 PZ',receptionMarked:true,flags:[]}]});
 const [row]=buildInvoiceRows(raw,[product()]);
 expect(row.flags).toContain('Clave de proveedor distinta; equivalencia sin verificar');expect(row.confirmed).toBe(false);expect(row.supplierSku).toBe('00002');expect(row.product?.supplierSku).toBe('00001');
 const exact=buildInvoiceRows({...raw,rows:[{...raw.rows[0],supplierSku:'00001'}]},[product()])[0];expect(exact.flags).toEqual([]);expect(exact.confirmedQuantity).toBe(3);
 const internal=[{id:'internal',external_id:'001'}],mappings=[{supplier:'Alpura',supplier_sku:'00002',product_id:'internal'}];
 const mapped=buildInvoiceRows(raw,[product()],internal,mappings)[0];expect(mapped.flags).toEqual([]);expect(mapped.evidence).toContain('Mapeo confirmado anteriormente');
 const conflict=buildInvoiceRows({...raw,rows:[{...raw.rows[0],description:'Crema rica 250g'}]},[product({name:'Crema rica 210g'})],internal,mappings)[0];expect(conflict.flags).toContain('Presentación o contenido distinto');expect(conflict.confirmed).toBe(false);
 });
 it('retains only output text and stop reason as private failure evidence and never parses a truncated result',()=>{
 const response={stop_reason:'max_tokens' as const,content:[{type:'text' as const,text:'{"rows":[',citations:null},{type:'thinking' as const,thinking:'private reasoning',signature:'private signature'}]};
 expect(invoiceOutputEvidence(response)).toEqual({stopReason:'max_tokens',textBlocks:['{"rows":[']});expect(()=>readInvoiceOutput(response)).toThrow();
 expect(invoiceRequestOptions(1).max_tokens).toBe(16000);expect(invoiceRequestOptions(5).max_tokens).toBe(32000);
 });
});
