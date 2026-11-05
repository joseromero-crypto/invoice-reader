import {it,expect} from 'vitest';
import {MV_CITY_COLUMNS,MV_PRODUCT_COLUMNS,canonicalCity,parseMasterviewFile} from '../shared/catalog';
import {barcodeKeys,buildLatest,planImport,type MvState} from '../shared/masterview';
import {asCatalogItem} from '../lean/catalog';
const header='id,sku,Item,city,Código de Barras,Image URL,Full Res. Image URL,Proveedor,SKU Proveedor,Unidad de compra,Peso neto o piezas (por unidad de compra),Deshabilitar compras,Calii Unit,Calii Sale Price';
const row=(id:number,sku:string,item:string,city:string,barcode='',image=`https://img/${sku}`)=>`${id},${sku},${item},${city},${barcode},${image},,Prov,,,,,pz,99`;
const file=(rows:string[],columns=header,name='x.csv')=>parseMasterviewFile([columns,...rows].join('\n'),name);
const empty:MvState={version:null,products:[],cities:[]};
// What the tables hold after a plan, as read_mv_state returns it.
function after(state:MvState,plan:ReturnType<typeof planImport>):MvState{
 const products=new Map(state.products.map(p=>[p.sku,p]));for(const p of plan.products)products.set(p.sku,p);
 const cities=[...state.cities.filter(c=>!plan.cities.includes(c.city)),...plan.rows.map(({city,row})=>({sku:row.sku,city,name:row.name,bc:row.barcode,import_id:'run'}))];
 return {version:'run',products:[...products.values()],cities,imports:[{id:'run',uploaded_at:'2026-11-05T00:00:00Z'}]};
}
const mty=()=>file([row(1,'TOM','Tomate huaje ahorramás','Monterrey','00750111'),row(2,'QSO','Queso','Monterrey','750222')]);
const gdl=()=>file([row(9,'TOM','Jitomate saladet ahorramás','Guadalajara','750111'),row(8,'SOLO','Solo tapatío','Guadalajara','750333','')]);
it('picks Monterrey as the base row, else the next city by priority',()=>{
 const plan=planImport([gdl(),mty(),file([row(5,'SOLO','Solo saltillo','Saltillo')])],empty);
 expect(plan.errors).toEqual([]);
 const by=new Map(plan.products.map(p=>[p.sku,p]));
 expect(by.get('TOM')).toMatchObject({name:'Tomate huaje ahorramás',base_city:'Monterrey',barcode:'00750111'});
 expect(by.get('SOLO')).toMatchObject({name:'Solo saltillo',base_city:'Saltillo'});
 expect(plan.report!.added).toBe(3);
});
it('normalizes city names and imports an unknown city last, with a warning',()=>{
 expect(canonicalCity(' monterrey ')).toBe('Monterrey');expect(canonicalCity('cdmx')).toBe('CDMX');
 const q=file([row(1,'X','Solo Q','Querétaro')]);expect(q.city).toBe('Querétaro');expect(q.warnings[0]).toMatch(/Querétaro/);
 const plan=planImport([q,file([row(2,'X','Nombre GDL','Guadalajara')])],empty);
 expect(plan.products[0]).toMatchObject({name:'Nombre GDL',base_city:'Guadalajara'});
});
it('reports regional names, per-city counts and missing vs Monterrey',()=>{
 const r=planImport([mty(),gdl()],empty).report!;
 expect(r.nameVariants).toEqual([{sku:'TOM',names:{Monterrey:'Tomate huaje ahorramás',Guadalajara:'Jitomate saladet ahorramás'}}]);
 expect(r.cities.Monterrey).toMatchObject({rows:2,exclusives:0,missingVsMonterrey:0});
 expect(r.cities.Guadalajara).toMatchObject({rows:2,exclusives:1,missingVsMonterrey:1});
});
it('puts a barcode used by different SKUs in alt, and lists the conflict',()=>{
 const plan=planImport([file([row(1,'A','Uno','Monterrey','111'),row(2,'B','Dos','Monterrey','222')]),file([row(3,'A','Uno','CDMX','333'),row(4,'B','Dos','CDMX','111')])],empty);
 expect(plan.report!.barcodeConflicts).toEqual([{barcode:'111',skus:[{sku:'A',cities:['Monterrey']},{sku:'B',cities:['CDMX']}]}]);
 const latest=buildLatest(after(empty,plan),[]);
 expect(latest.map['111']).toEqual({url:'https://img/A',name:'Uno',sku:'A',c:['Monterrey','CDMX']});
 expect(latest.alt['111']).toEqual([{url:'https://img/B',name:'Dos',sku:'B',c:['CDMX']}]);
});
it('a barcode repeated inside one city never overrides the map entry there',()=>{
 const plan=planImport([file([row(1,'A','Uno','Monterrey','111'),row(2,'B','Dos','Monterrey','111')]),file([row(3,'A','Uno','CDMX','111')])],empty);
 expect(plan.report!.barcodeConflicts).toHaveLength(1);
 const latest=buildLatest(after(empty,plan),[]);expect(latest.map['111']).toMatchObject({sku:'A'});expect(latest.alt['111']).toBeUndefined();
});
it('builds latest.json in the shape the static apps read',()=>{
 const plan=planImport([mty(),gdl()],empty),latest=buildLatest(after(empty,plan),[{name:'MH Contry',city:'Monterrey',active:true},{name:'Cerrado',city:'CDMX',active:false}]);
 expect(latest).toMatchObject({version:'run',updatedAt:'2026-11-05T00:00:00Z',count:3,cities:['Monterrey','Guadalajara'],cityUpdatedAt:{Monterrey:'2026-11-05T00:00:00Z',Guadalajara:'2026-11-05T00:00:00Z'},hubCities:{'mh-contry':'Monterrey'}});
 expect(latest.map['750111']).toEqual({url:'https://img/TOM',name:'Tomate huaje ahorramás',sku:'TOM',c:['Monterrey','Guadalajara']});
 expect(latest.map['tomate huaje ahorramas']).toBe('https://img/TOM');expect(latest.map['jitomate saladet ahorramas']).toBe('https://img/TOM');
 expect(latest.map['750333']).toEqual({url:null,name:'Solo tapatío',sku:'SOLO',c:['Guadalajara']});
 expect(barcodeKeys('0012, 34;7.50E+03')).toEqual(['12','34','7500']);
});
it('on a name clash the Monterrey product keeps the name key',()=>{
 const plan=planImport([file([row(1,'A','Pan','Monterrey','1')]),file([row(2,'B','Pan','CDMX','2')])],empty);
 expect(buildLatest(after(empty,plan),[]).map.pan).toBe('https://img/A');
});
it('rejects a duplicate SKU, a mixed-city file and empty keys, naming the city',()=>{
 expect(file([row(1,'A','Uno','CDMX'),row(2,'A','Otro','CDMX')]).errors[0]).toMatch(/El archivo de CDMX.*SKU duplicado A/);
 expect(file([row(1,'A','Uno','CDMX'),row(2,'B','Dos','Saltillo')]).errors[0]).toMatch(/mezcla ciudades \(CDMX, Saltillo\)/);
 expect(file([row(1,'','Uno','CDMX')]).errors[0]).toMatch(/fila 2 sin sku/);
 expect(file([row(1,'A','Uno','CDMX'),row(2,'B','Dos','')]).errors[0]).toMatch(/fila 3 sin city/);
});
it('rejects the same city twice',()=>{
 expect(planImport([mty(),mty()],empty).errors).toEqual(['Hay dos archivos de Monterrey: sube uno por ciudad.']);
});
it('a file without Image URL stops the whole upload',()=>{
 const lean=file([row(9,'Z','Z','CDMX')],header.replace('Image URL,Full','Otra,Full'));
 expect(lean.errors[0]).toBe('El archivo de CDMX: Falta Image URL — ¿es la exportación completa de Masterview?');
 const plan=planImport([mty(),lean],empty);expect(plan.errors).toHaveLength(1);expect(plan.products).toEqual([]);expect(plan.rows).toEqual([]);expect(plan.report).toBeNull();
});
it('blocks a city that dropped more than 10% unless the admin confirms',()=>{
 const rows=Array.from({length:20},(_,i)=>row(i,`S${i}`,`P${i}`,'CDMX'));
 const state=after(empty,planImport([file(rows)],empty));
 const smaller=file(rows.slice(0,17));
 const blocked=planImport([smaller],state);expect(blocked.errors[0]).toMatch(/CDMX bajó de 20 a 17 filas/);expect(blocked.products).toEqual([]);
 expect(planImport([smaller],state,{confirmDrop:true}).errors).toEqual([]);
 expect(planImport([file(rows.slice(0,18))],state).errors).toEqual([]);
});
it('a CDMX-only upload changes nothing for the other cities',()=>{
 const state=after(empty,planImport([mty(),file([row(5,'TOM','Jitomate','CDMX','750111'),row(6,'EXT','Solo CDMX','CDMX')])],empty));
 const plan=planImport([file([row(5,'TOM','Jitomate nuevo','CDMX','750111')])],state,{confirmDrop:true,now:'NOW'});
 expect(plan.rows.every(r=>r.city==='CDMX')).toBe(true);expect(plan.cities).toEqual(['CDMX']);
 expect(plan.report!.cities.Monterrey).toMatchObject({rows:2,replaced:false});expect(plan.report!.cities.CDMX).toMatchObject({rows:1,replaced:true});
 expect(plan.products.map(p=>p.sku)).toEqual(['EXT']);expect(plan.report).toMatchObject({retired:['EXT'],added:0,updated:0,unchanged:2});
});
it('a SKU retires only when no city has it, and moves base when Monterrey loses it',()=>{
 const state=after(empty,planImport([mty(),gdl()],empty));
 const plan=planImport([file([row(2,'QSO','Queso','Monterrey','750222')])],state,{confirmDrop:true});
 expect(plan.report!.retired).toEqual([]);
 expect(plan.products.find(p=>p.sku==='TOM')).toMatchObject({base_city:'Guadalajara',name:'Jitomate saladet ahorramás',barcode:'750111',image_url:'https://img/TOM'});
 const gone=planImport([file([row(9,'TOM','Jitomate saladet ahorramás','Guadalajara','750111')])],after(state,plan),{confirmDrop:true,now:'NOW'});
 expect(gone.report!.retired).toEqual(['SOLO']);expect(gone.products.find(p=>p.sku==='SOLO')!.raw.retired_at).toBe('NOW');
 const twice=after(after(state,plan),gone);expect(buildLatest(twice,[]).map['750333']).toBeUndefined();
 expect(planImport([file([row(9,'TOM','Jitomate saladet ahorramás','Guadalajara','750111')])],twice,{now:'LATER'}).report!.retired).toEqual([]);
});
it('counts added, updated and unchanged against what is stored',()=>{
 const state=after(empty,planImport([mty()],empty));
 const r=planImport([file([row(1,'TOM','Tomate huaje ahorramás','Monterrey','00750111'),row(2,'QSO','Queso fresco','Monterrey','750222'),row(3,'NEW','Nuevo','Monterrey')])],state).report!;
 expect(r).toMatchObject({added:1,updated:1,unchanged:1});
});
it('keeps only the whitelist, and match() still gets every column it reads',()=>{
 const f=file(['7,SKU1,Item uno,Monterrey,-,https://img/x,https://big/x,LALA,21541,Caja,"12",true,pz,99']);
 const [r]=f.rows;expect(r).toMatchObject({barcode:null,deshabilitarCompras:true,piezasPorUnidad:12,skuProveedor:'21541'});
 expect(Object.keys(r.productRaw).every(k=>(MV_PRODUCT_COLUMNS as readonly string[]).includes(k))).toBe(true);
 expect(Object.keys(r.cityRaw).every(k=>(MV_CITY_COLUMNS as readonly string[]).includes(k))).toBe(true);
 expect(JSON.stringify({...r.productRaw,...r.cityRaw})).not.toContain('99');
 expect(asCatalogItem({id:'uuid',sku:r.sku,raw:r.productRaw,city_row:{name:r.name,raw:r.cityRaw}})).toEqual({id:'uuid',name:'Item uno',sku:'SKU1',supplier:'LALA',supplierSku:'21541',barcodes:[],purchaseUnit:'Caja',perPurchaseUnit:12});
});
