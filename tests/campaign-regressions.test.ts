import {it,expect} from 'vitest';
import {buildInvoiceRows} from '../server/match-extraction';
import {ExtractionSchema,exportCsv,type Product,type Document} from '../shared/domain';
import {operationalWarnings,documentWarnings} from '../shared/receiving-policy';
const product:Product={id:'synthetic-id',sku:'00007',name:'Bebida limón 1L',supplier:'Synthetic',supplierSku:'00042',barcode:'0000123456789',unit:'pz'};
const source=(changes:any={})=>({sourcePage:1,sourceRow:1,supplierSku:'00042',barcode:null,description:'Bebida JAMAIC 1L',quantity:7,unit:'PZ',packContents:null,price:null,discount:null,tax:null,amount:null,rawText:'00042 Bebida JAMAIC 1L 7 PZ',receptionMarked:true,flags:[],...changes});
const extraction=(rows:any[])=>ExtractionSchema.parse({supplier:'Synthetic',reference:'SYNTHETIC',date:null,currency:null,printedPage:null,printedPageCount:null,printedTotal:null,warnings:[],rows});
const doc=(rows:any[]):Document=>({id:'d',supplier:'Synthetic',reference:'SYNTHETIC',pages:1,image:null,expectedPages:null,warnings:[],printedTotal:null,rows});
it('compact explicit flavors defeat exact keys, barcodes and mappings',()=>{
 for(const description of ['Bebida JAMAIC 1L','Bebida JAMAICA1L']){
 const [row]=buildInvoiceRows(extraction([source({description,barcode:product.barcode})]),[product],[{id:'internal',external_id:product.id}],[{supplier:'Synthetic',supplier_sku:'00042',product_id:'internal'}]);
 expect(row.flags).toContain('Variante o sabor en conflicto');expect(row.confirmed).toBe(false);
 }
});
it('equivalent catalog multipacks avoid false size conflicts while count and dimension conflicts survive',()=>{
 const pack={...product,name:'Mantequilla 320g 4pz'};
 const [same]=buildInvoiceRows(extraction([source({description:'Mantequilla 80 gr 4pz'})]),[pack]);expect(same.flags).toEqual([]);expect(same.confirmedQuantity).toBe(7);
 for(const description of ['Mantequilla 80 gr 3pz','Mantequilla 80 ml 4pz','Mantequilla 75gr 4pz','Mantequilla 1280g 4pz'])expect(buildInvoiceRows(extraction([source({description})]),[pack])[0].flags).toContain('Presentación o contenido distinto');
});
it('keeps alignment uncertainty even when cosmetic angle wording is present',()=>{
 const warning='Photo angle: row alignment uncertain; quantities matched in order';expect(operationalWarnings([warning])).toEqual([warning]);
});
it('recognized raw cross evidence remains pending and good neighboring rows stay usable',()=>{
 const raw=extraction([source({description:product.name,rawText:'00042 Bebida 1L 7 PZ; marca de cruz X'}),source({sourceRow:2,description:product.name})]);
 const before=JSON.stringify(raw);const rows=buildInvoiceRows(raw,[product]);expect(rows[0].flags.length).toBeGreaterThan(0);expect(rows[0].receptionMarked).toBe(false);expect(rows[0].confirmed).toBe(false);expect(rows[1].confirmed).toBe(true);
 const output=exportCsv([doc(rows)],true);expect(output.excluded).toHaveLength(1);expect(output.csv.split('\r\n')).toHaveLength(2);expect(JSON.stringify(raw)).toBe(before);
});
it('structured reception observations override a simultaneous check without losing printed quantity',()=>{
 for(const kind of ['cross','circle','changed_quantity','return','ambiguous']){
 const [row]=buildInvoiceRows(extraction([source({description:product.name,reception:{kind,text:'Visible annotation',quantity:5}})]),[product]);expect(row.flags.length).toBeGreaterThan(0);expect(row.confirmed).toBe(false);expect(row.billedQuantity).toBe(7);expect(row.proposedQuantity).toBe(7);
 }
 const [same]=buildInvoiceRows(extraction([source({description:product.name,reception:{kind:'same_quantity',text:'7',quantity:7}})]),[product]);expect(same.flags).toEqual([]);expect(same.confirmed).toBe(false);
 const [inconsistent]=buildInvoiceRows(extraction([source({description:product.name,reception:{kind:'same_quantity',text:'5',quantity:5}})]),[product]);expect(inconsistent.flags.length).toBeGreaterThan(0);
});
it('preserves row order, repeated lines, null quantities and exact source identifiers',()=>{
 const raw=extraction([source({sourceRow:3,description:product.name}),source({sourceRow:4,description:product.name,quantity:null}),source({sourceRow:5,description:product.name})]);
 const rows=buildInvoiceRows(raw,[product]);expect(rows.map(r=>r.sourceRow)).toEqual([3,4,5]);expect(rows.map(r=>r.billedQuantity)).toEqual([7,null,7]);expect(rows[1].confirmed).toBe(false);expect(rows[2].supplierSku).toBe('00042');
});
it('never substitutes a catalog barcode for missing or explicitly cleared source provenance',()=>{
 const [row]=buildInvoiceRows(extraction([source({description:product.name})]),[product]);const csv=exportCsv([doc([row])]).csv;expect(csv).toContain('"00042",""');expect(csv).not.toContain(product.barcode!);
 row.corrections={barcode:null};expect(exportCsv([doc([row])]).csv).not.toContain(product.barcode!);
});
it('new field uncertainty stays local without discarding genuine cropped-key findings',()=>{
 const raw=extraction([source({description:product.name,fieldUncertainties:[{field:'supplierSku',reason:'Ink obscures one character'}]}),source({sourceRow:2,description:product.name})]);
 const rows=buildInvoiceRows(raw,[product]);expect(rows[0].flags).toContain('supplierSku: Ink obscures one character');expect(rows[0].confirmed).toBe(false);expect(rows[1].confirmed).toBe(true);
 const [old]=buildInvoiceRows(extraction([source({description:product.name,flags:['clave recortada']})]),[product]);expect(old.flags).toContain('clave recortada');
});

it('separates provider status claims from the operative document warning',()=>{
 const warning='Marca de recepción ambigua en fila 2; se dejó pendiente.';
 expect(documentWarnings([warning])[0]).toContain('Marca de recepción ambigua');
 expect(documentWarnings([warning])[0]).not.toContain('se dejó pendiente');
});
it('checks with incidental row numbers do not become numeric shortages, and later conflicts still survive',()=>{
 const [good]=buildInvoiceRows(extraction([source({description:product.name,rawText:'Bebida 1L 7 PZ; handwritten check mark beside row 1'})]),[product]);expect(good.flags).toEqual([]);
 const [bad]=buildInvoiceRows(extraction([source({description:product.name,rawText:'Bebida 1L 7 PZ; handwritten check mark; marca de cruz X'})]),[product]);expect(bad.flags.length).toBeGreaterThan(0);expect(bad.confirmed).toBe(false);
});

it('a check classification cannot override contradictory annotation evidence',()=>{
 for(const reception of [{kind:'check',text:'5',quantity:5},{kind:'check',text:'crossed out',quantity:null}]){
 const [row]=buildInvoiceRows(extraction([source({description:product.name,reception})]),[product]);expect(row.flags.length).toBeGreaterThan(0);expect(row.confirmed).toBe(false);
 }
 for(const kind of ['signature','none'])expect(buildInvoiceRows(extraction([source({description:product.name,reception:{kind,text:null,quantity:null}})]),[product])[0].confirmed).toBe(false);
});

it('retains explicit formulation contradictions without inventing missing qualifiers',()=>{
 for(const [description,name] of [['Leche entera 1L','Leche light 1L'],['Mantequilla sin sal 100g','Mantequilla con sal 100g'],['Bebida naranja 1L','Bebida limón 1L']]){
 const [row]=buildInvoiceRows(extraction([source({description})]),[{...product,name}]);expect(row.flags).toContain('Variante o sabor en conflicto');expect(row.confirmed).toBe(false);
 }
 const [omitted]=buildInvoiceRows(extraction([source({description:'Leche 1L'})]),[{...product,name:'Leche deslactosada 1L'}]);expect(omitted.flags).not.toContain('Variante o sabor en conflicto');
});

it('direct piece and package counts ignore stored pack-content factors',()=>{
 for(const unit of ['PZ','PIEZA(S)','XPK','PQ',null]){
 const [row]=buildInvoiceRows(extraction([source({description:product.name,unit})]),[product],[{id:'internal',external_id:product.id}],[],[{product_id:'internal',supplier:'Synthetic',source_unit:unit,factor:4}]);expect(row.proposedQuantity).toBe(7);expect(row.confirmedQuantity).toBe(7);
 }
});
it('quoted handwritten numbers remain pending when the reader omits their flags',()=>{
 const [row]=buildInvoiceRows(extraction([source({description:product.name,rawText:"Bebida 1L 7 PZ; manuscrito '5'"})]),[product]);expect(row.confirmed).toBe(false);expect(row.flags.length).toBeGreaterThan(0);
});

it('an explicit false reception decision vetoes an inconsistent check classification',()=>{
 const [row]=buildInvoiceRows(extraction([source({description:product.name,receptionMarked:false,reception:{kind:'check',text:'check',quantity:null}})]),[product]);expect(row.confirmed).toBe(false);expect(row.receptionMarked).toBe(false);
});

it('source uncertainty survives cosmetic financial wording',()=>{
 const warning='Barcode partially cropped beside the printed price';expect(operationalWarnings([warning])).toEqual([warning]);
});
