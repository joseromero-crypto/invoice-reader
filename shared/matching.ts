import type {Candidate,Product} from './domain.ts';
export const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9.]+/g,' ').trim();
// Verified legal/trading names; raw invoice/catalog values are never rewritten.
export function supplierIdentity(supplier:string){
 const legal=normalize(supplier).replace(/\./g,'').replace(/\s+/g,' ').replace(/\s+(?:s\s*a(?:\s*p\s*i)?|s\s*de\s*r\s*l)\s+de\s+c\s*v$/, '').trim();
 return ({'comercializadora de lacteos y derivados':'lala','hygeia de mexico':'hygeia','ganaderos productores de leche pura':'alpura','distribuidora arca continental':'arca continental','sigma alimentos comercial':'sigma ecommerce','qualtia alimentos operaciones':'qualtia','mission foods mexico':'mission foods'} as Record<string,string>)[legal]??legal;
}
export const supplierKey=(supplier:string,sku:string)=>supplierIdentity(supplier)+'|'+(supplierIdentity(supplier)==='lala'&&/^\d+$/.test(sku)?sku.replace(/^0+(?=\d)/,''):sku.trim());
export const unverifiedSupplierKeyFlag='Clave de proveedor distinta; equivalencia sin verificar';
const size=(s:string)=>[...normalize(s).matchAll(/(\d+(?:\.\d+)?)\s*(kg|ml|grs?|g|lt|l)(?=\b|\d|nc\b)/g)].map(m=>`${Number(m[1])*(['kg','l','lt'].includes(m[2])?1000:1)}${['kg','gr','grs','g'].includes(m[2])?'g':'ml'}`);
// Recognize explicit printed words and common compact abbreviations, with token
// boundaries (including adjacent size digits). Never complete unknown source text.
const variants:Record<string,string>={limon:'limon',jamaic:'jamaica',jamaica:'jamaica',fresa:'fresa',vainilla:'vainilla',chocolate:'chocolate',integral:'integral',multigrano:'multigrano',blanco:'blanco',dragon:'dragon',durazno:'durazno',mango:'mango',pavo:'pavo',cerdo:'cerdo',almend:'almendra',almendra:'almendra',coco:'coco',nuez:'nuez',naranja:'naranja',manzana:'manzana',pina:'pina',mora:'mora',uva:'uva',natural:'natural',guayaba:'guayaba',tamarindo:'tamarindo',toronja:'toronja',sandia:'sandia'};
const flavors=(s:string)=>[...s.matchAll(/(?:^|[^a-z])(limon|jamaica?|fresa|vainilla|chocolate|integral|multigrano|blanco|dragon|durazno|mango|pavo|cerdo|almendra|almend|coco|nuez|naranja|manzana|pina|mora|uva|natural|guayaba|tamarindo|toronja|sandia)(?=$|[^a-z])/g)].map(m=>variants[m[1]]);
const explicitOpposites=[
 [/(?:^|[^a-z])(?:entera|entero|ent)(?=$|[^a-z])/,/(?:^|[^a-z])(?:descremada|descremado|descr|light|semidescremada|semi)(?=$|[^a-z])/],
 [/(?:^|[^a-z])(?:sin sal|s sal)(?=$|[^a-z])/,/(?:^|[^a-z])(?:con sal|salada|salado)(?=$|[^a-z])/],
 [/(?:^|[^a-z])(?:sin azucar|s azuc|s azucar)(?=$|[^a-z])/,/(?:^|[^a-z])con azucar(?=$|[^a-z])/],
 [/(?:^|[^a-z])(?:deslactosada|deslactosado|desl|sin lactosa)(?=$|[^a-z])/,/(?:^|[^a-z])con lactosa(?=$|[^a-z])/]
];
const explicitVariantConflict=(a:string,b:string)=>explicitOpposites.some(([x,y])=>(x.test(a)&&y.test(b))||(y.test(a)&&x.test(b)));
const packCount=(s:string)=>{const text=normalize(s);const found=[...text.matchAll(/(?:^|[^a-z0-9])(\d+)\s*(?:pz|pzs|pzas?|piezas?|packs?)(?=$|[^a-z])/g)];return found.length===1?Number(found[0][1]):null;};
function presentationConflict(source:string,catalog:string){
 const a=size(source),b=size(catalog),pa=packCount(source),pb=packCount(catalog);
 if(pa!==null&&pb!==null&&pa!==pb)return true;
 if(!a.length||!b.length||a.some(x=>b.includes(x)))return false;
 // Catalog packs may state total weight while supplier text states component weight.
 // Require the same explicit count/dimension. The inverse representation still
 // needs source review; do not reinterpret a larger supplier size as a total.
 // Never scale row quantities.
 if(pa!==null&&pa>1&&pa===pb&&a.some(x=>b.some(y=>{
  const ax=x.match(/^(.*?)(g|ml)$/)!,by=y.match(/^(.*?)(g|ml)$/)!;
  return ax[2]===by[2]&&Number(ax[1])*pa===Number(by[1]);
 })))return false;
 return true;
}
export function matchProducts(input:{supplier:string;supplierSku:string|null;barcode:string|null;description:string},products:Product[]):Candidate[]{
 const text=normalize(input.description),tokens=text.split(' ').filter(t=>t.length>1),matches:Candidate[]=[];
 const knownSupplier=products.some(p=>supplierIdentity(p.supplier)===supplierIdentity(input.supplier));
 for(const product of products){
 const evidence:string[]=[],flags:string[]=[];let score=0;
 if(input.barcode&&product.barcode===input.barcode){evidence.push('Código de barras exacto');score+=5;}
 if(input.supplierSku&&product.supplierSku&&supplierKey(input.supplier,input.supplierSku)===supplierKey(product.supplier,product.supplierSku)){evidence.push('SKU + proveedor');score+=5;}
 const name=normalize(product.name),overlap=tokens.filter(t=>name.includes(t)).length/Math.max(tokens.length,1);
 if(tokens.length>=2&&overlap>=0.65){evidence.push('Descripción compatible');score+=overlap*4;}
 if(!evidence.length)continue;
 if(knownSupplier&&supplierIdentity(product.supplier)!==supplierIdentity(input.supplier))flags.push('Proveedor de catálogo distinto; requiere verificar');
 // A description alone cannot establish that two different supplier keys are equivalent.
 if(input.supplierSku&&product.supplierSku&&supplierIdentity(product.supplier)===supplierIdentity(input.supplier)&&supplierKey(input.supplier,input.supplierSku)!==supplierKey(product.supplier,product.supplierSku)&&!evidence.includes('Código de barras exacto'))flags.push(unverifiedSupplierKeyFlag);
 if(presentationConflict(input.description,product.name))flags.push('Presentación o contenido distinto');
 const fa=flavors(text),fb=flavors(name);
 if((fa.length&&fb.length&&fa.some(f=>!fb.includes(f))&&fb.some(f=>!fa.includes(f)))||explicitVariantConflict(text,name))flags.push('Variante o sabor en conflicto');
 if(input.barcode&&product.barcode===input.barcode&&products.filter(p=>p.barcode===input.barcode).length>1)flags.push('Código de barras duplicado en catálogo');
 if(input.supplierSku&&product.supplierSku&&evidence.includes('SKU + proveedor')&&products.filter(p=>p.supplierSku&&supplierKey(p.supplier,p.supplierSku)===supplierKey(input.supplier,input.supplierSku!)).length>1)flags.push('SKU de proveedor ambiguo');
 matches.push({product,evidence,flags,score});
 }
 matches.sort((a,b)=>b.score-a.score);
 if(matches.length>1&&matches[0].score===matches[1].score)matches[0].flags.push('Varios candidatos con la misma evidencia');
 if(matches[0]&&matches.some(m=>m.product.id!==matches[0].product.id&&m.evidence.some(e=>e.includes('exacto')||e==='SKU + proveedor')))matches[0].flags.push('Los identificadores señalan productos distintos');
 return matches.slice(0,8);
}
