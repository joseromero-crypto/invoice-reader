import {describe,it,expect} from 'vitest';
import {buildInvoiceRows} from '../server/match-extraction';
import {operationalWarnings,hasReceptionMark} from '../shared/receiving-policy';
import {supplierKey,matchProducts} from '../shared/matching';
import {ExtractionSchema,type Product,exportCsv} from '../shared/domain';
const product=(p:Partial<Product>={}):Product=>({id:'001',sku:'EXAMPLE',name:'Postre LALA 125g / 4pz',supplier:'LALA',supplierSku:'123',barcode:null,unit:'pz',...p});
const extraction=(changes:any={})=>ExtractionSchema.parse({supplier:'Comercializadora de Lacteos y Derivados, S.A. de C.V.',reference:'TEST',date:null,currency:null,printedPage:2,printedPageCount:3,printedTotal:null,warnings:[],rows:[{sourcePage:1,sourceRow:1,supplierSku:'000123',barcode:null,description:'Postre LALA 125g 4pz',quantity:3,unit:'PZ',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:'000123 Postre LALA 125g 4pz PZ 3',flags:['handwritten_check_mark','pack_contents_in_description_unconfirmed'],...changes}]});
describe('uploaded-page receiving policy',()=>{
 it('keeps a printed PZ count as catalog packs and accepts clear reception marks',()=>{
 const raw=extraction(),before=JSON.stringify(raw);const [row]=buildInvoiceRows(raw,[product()]);
 expect(row.proposedQuantity).toBe(3);expect(row.confirmedQuantity).toBe(3);expect(row.flags).toEqual([]);expect(row.receptionMarked).toBe(true);expect(JSON.stringify(raw)).toBe(before);
 expect(exportCsv([{id:'d',supplier:'TEST',reference:'TEST',image:null,pages:1,expectedPages:3,warnings:[],printedTotal:null,rows:[row]}]).csv).toContain('"3"');
 });
 it('normalizes only verified supplier identities and LALA leading zeros',()=>{
 expect(supplierKey('Comercializadora de Lácteos y Derivados, S.A. de C.V.','000123')).toBe(supplierKey('LALA','123'));
 expect(supplierKey('HYGEIA DE MEXICO, S.A. de C.V.','001')).toBe(supplierKey('Hygeia','001'));
 expect(supplierKey('Unrelated supplier','000123')).not.toBe(supplierKey('LALA','123'));
 expect(supplierKey('Unrelated supplier','001')).toContain('001');
 });
 it('does not let checks resolve contradictory identity, size, or conversion',()=>{
 const [wrong]=buildInvoiceRows(extraction({description:'Postre coco 900g'}),[product({name:'Postre almendra 125g'})]);
 expect(wrong.flags).toContain('Variante o sabor en conflicto');expect(wrong.flags).toContain('Presentación o contenido distinto');expect(wrong.confirmed).toBe(false);
 const [weight]=buildInvoiceRows(extraction({unit:'kg'}),[product()]);expect(weight.confirmed).toBe(false);expect(weight.proposedQuantity).toBeNull();
 const [unknown]=buildInvoiceRows(extraction({supplierSku:'999',description:'?'}),[product()]);expect(unknown.confirmed).toBe(false);expect(unknown.product).toBeNull();expect(unknown.billedQuantity).toBe(3);
 });
 it('leaves unmarked or uncertain reception for manual confirmation',()=>{
 expect(buildInvoiceRows(extraction({flags:[]}),[product()])[0].confirmed).toBe(false);
 expect(hasReceptionMark(['handwritten check mark unclear'])).toBe(false);
 expect(buildInvoiceRows(extraction({receptionMarked:false}),[product()])[0].confirmed).toBe(false);
 });
 it('removes irrelevant warning noise while retaining unreadable quantities and keys',()=>{
 expect(operationalWarnings(['Printed page marker is 2/3; pages 1 and 3 were not provided','No unit prices printed','The printed SUBTOTAL cannot be reconciled','Currency not stated','Photo shows clipboard background','Handwritten check marks are not proof','Documento incompleto: 1 de 3 páginas.','Quantities sit below description because of photo angle'])).toEqual([]);
 expect(operationalWarnings(['Cantidad ilegible en fila 3','Clave ilegible por marca en el código','Posible factura duplicada'])).toHaveLength(3);
 });
 it('recognizes alternate unit spelling and preserves mismatched identifiers',()=>{
 const found=matchProducts({supplier:'LALA',supplierSku:'123',barcode:null,description:'Leche 1Lt'},[product({name:'Leche LALA 1000ml'})]);expect(found[0].flags).not.toContain('Presentación o contenido distinto');
 const [duplicate]=buildInvoiceRows(extraction(),[product(),product({id:'002'})]);expect(duplicate.flags).toContain('SKU de proveedor ambiguo');expect(duplicate.confirmed).toBe(false);
 });
});
