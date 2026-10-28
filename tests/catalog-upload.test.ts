import {it,expect} from 'vitest';
import {parseCatalog,mergeCatalog,catalogExample} from '../shared/catalog';
import {confirmRow,exportCsv} from '../shared/domain';
const csv='id,sku,Item,Description,Proveedor,SKU Proveedor,Código de Barras,Calii Unit\n001,AB01,"  Nombre EXACTO, desde Retool  ",Nota para almacén,Proveedor,0001,00001234,pz';
it('preserves the exact exported display text instead of generating a product description',()=>{
 const result=parseCatalog(csv);expect(result.errors).toEqual([]);expect(result.products[0].name).toBe('  Nombre EXACTO, desde Retool  ');expect(result.products[0].nameColumn).toBe('Item');expect(result.products[0].raw?.Description).toBe('Nota para almacén');
 const example=catalogExample(result.products);const row=example.documents[0].rows[0];expect(row.product?.name).toBe(result.products[0].raw?.Item);
 const confirmed=confirmRow(row,row.product!,1,true);expect(exportCsv([{...example.documents[0],rows:[confirmed]}]).csv).toContain('"  Nombre EXACTO, desde Retool  "');
});
it('uses the explicitly selected column with no silent fallback for blanks',()=>{
 expect(parseCatalog(csv,{nameColumn:'Description'}).products[0].name).toBe('Nota para almacén');
 expect(parseCatalog(csv.replace('Nota para almacén',''),{nameColumn:'Description'}).errors[0]).toContain('Description');
 expect(parseCatalog(csv,{nameColumn:'Unknown'}).errors).toContain('Falta la columna Unknown.');
});
it('merges updates and new products by text ID without dropping products absent from a partial export',()=>{
 const first=parseCatalog(csv).products;const second=parseCatalog('id,sku,Item,Calii Unit\n002,B,Segundo,pz').products;
 const base=mergeCatalog(first,second);expect(base.added).toBe(1);expect(base.products).toHaveLength(2);
 const changed=parseCatalog(csv.replace('Nombre EXACTO, desde Retool','Nombre corregido')).products;
 const updated=mergeCatalog(base.products,changed);expect(updated.updated).toBe(1);expect(updated.products).toHaveLength(2);expect(updated.products.find(p=>p.id==='002')?.name).toBe('Segundo');
 expect(mergeCatalog(updated.products,changed).unchanged).toBe(1);
});
it('rejects malformed CSV, duplicate headers, empty files and missing product identities',()=>{
 expect(parseCatalog('').errors.length).toBeGreaterThan(0);expect(parseCatalog('id,sku,Item\n1,A,"bad').errors[0]).toContain('CSV inválido');
 expect(parseCatalog('id,sku,Item,Item\n1,A,x,y').errors).toContain('El archivo contiene encabezados duplicados.');
});
