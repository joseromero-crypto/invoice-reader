import {it,expect} from 'vitest';
import {asCatalogItem,cityItems,withCityRows} from '../lean/catalog.ts';
import {asProducts,catalog} from '../server/workspace';
const row=(city:string,name:string,raw:Record<string,string|null>={})=>({city,name,raw:{Item:name,...raw}});
const mty=row('Monterrey','Tomate huaje',{Proveedor:'LALA','SKU Proveedor':'21541','Código de Barras':'750111','Unidad de compra':'Caja','Peso neto o piezas (por unidad de compra)':'12'});
const product=(rows:any[],o={})=>({id:'p',sku:'AAA',base_city:'Monterrey',barcode:'750111',raw:{},city_rows:rows,...o});
it('reads the hub city row and falls back to the base row for empty values',()=>{
 const cdmx=row('CDMX','Jitomate saladet',{Proveedor:'Otro','SKU Proveedor':'-','Código de Barras':'','Unidad de compra':'Caja','Peso neto o piezas (por unidad de compra)':'6'});
 expect(asCatalogItem(product([mty,cdmx]),cdmx)).toMatchObject({name:'Jitomate saladet',supplier:'Otro',supplierSku:'21541',barcodes:['750111'],purchaseUnit:'Caja',perPurchaseUnit:6,aliases:['Tomate huaje']});
 const empty=row('Saltillo','Tomate huaje');
 const item=asCatalogItem(product([mty,empty]),empty);
 expect(item).toMatchObject({supplier:'LALA',supplierSku:'21541',purchaseUnit:'Caja',perPurchaseUnit:12});expect(item.aliases).toBeUndefined();
});
it('keeps pieces empty when the city buys in another unit than the base row',()=>{
 const gdl=row('Guadalajara','Tomate huaje',{'Unidad de compra':'Pieza'});
 expect(asCatalogItem(product([mty,gdl]),gdl)).toMatchObject({purchaseUnit:'Pieza',perPurchaseUnit:null});
});
it('marks every other city row, and a city-exclusive product is local in its city',()=>{
 const salt=row('Saltillo','Agua local',{Proveedor:'Arca','SKU Proveedor':'14'});
 const products=[product([mty,row('CDMX','Jitomate saladet')]),product([salt],{id:'x',sku:'XXX',base_city:'Saltillo'})];
 expect(cityItems(products,'Monterrey').map(i=>[i.id,i.otherCity])).toEqual([['p',undefined],['p','CDMX'],['x','Saltillo']]);
 expect(cityItems(products,'Saltillo').map(i=>[i.id,i.otherCity])).toEqual([['p','Monterrey'],['p','CDMX'],['x',undefined]]);
});
it('a hub with no city reads the rows as they came, with no city data',()=>{
 const items=cityItems([{id:'p',sku:'AAA',raw:{},city_row:mty}],null);
 expect(items).toHaveLength(1);expect(items[0]).toMatchObject({name:'Tomate huaje',supplierSku:'21541',perPurchaseUnit:12});expect(items[0].otherCity).toBeUndefined();expect(items[0].aliases).toBeUndefined();
});
it('merges the hub catalog with the other cities and lists the hub city first',()=>{
 const merged=withCityRows([{id:'p',sku:'AAA',base_city:'Monterrey',raw:{},city_row:row('CDMX','Jitomate saladet')}],[
  {product:{id:'z',sku:'ZZZ',base_city:'Saltillo',calii_unit:'pz'},row:row('Saltillo','Agua local')},
  {product:{id:'p',sku:'AAA',base_city:'Monterrey'},row:mty}]);
 const products=asProducts([merged[1],merged[0]],'CDMX');
 expect(products.map(p=>[p.id,p.name,p.otherCity])).toEqual([['p','Jitomate saladet',undefined],['z','Agua local','Saltillo']]);
 expect(products[0].aliases).toEqual(['Tomate huaje']);
});
it('reads the hub city with the catalog RPC and the others by page, skipping retired products',async()=>{
 const ranges:number[][]=[],rpc:any[]=[];
 const rows=[{sku:'AAA',city:'Monterrey',name:'Tomate huaje',barcode:null,proveedor:'LALA',sku_proveedor:'21541',unidad_compra:'Caja',piezas_por_unidad:12,mv_products:{id:'p',base_city:'Monterrey',calii_unit:'pz',barcode:'750111',retired:null}},
  {sku:'OLD',city:'Monterrey',name:'Retirado',barcode:null,proveedor:null,sku_proveedor:null,unidad_compra:null,piezas_por_unidad:null,mv_products:{id:'o',base_city:'Monterrey',calii_unit:'pz',barcode:null,retired:'2026-11-01'}}];
 const db:any={rpc:async(name:string,args:any)=>{rpc.push([name,args]);return {data:name==='mv_city_status'?[{city:'Monterrey',rows:1500},{city:'CDMX',rows:9}]:[{id:'p',sku:'AAA',base_city:'Monterrey',barcode:'750111',raw:{},city_row:row('CDMX','Jitomate saladet')}],error:null};},
  from:()=>{const chain:any={};for(const m of ['select','neq','order'])chain[m]=()=>chain;chain.range=async(a:number,b:number)=>{ranges.push([a,b]);return {data:a?[]:rows,error:null};};return chain;}};
 const products=await catalog(db,'CDMX');
 expect(rpc).toContainEqual(['read_mv_catalog',{p_city:'CDMX'}]);expect(ranges).toEqual([[0,999],[1000,1999]]);
 expect(products.map(p=>p.sku)).toEqual(['AAA']);
 expect(cityItems(products,'CDMX')[1]).toMatchObject({otherCity:'Monterrey',supplierSku:'21541',perPurchaseUnit:12,barcodes:['750111']});
});
