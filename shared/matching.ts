import type {Candidate,Product} from './domain.ts';
export const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9.]+/g,' ').trim();
// Verified legal/trading names; raw invoice/catalog values are never rewritten.
export function supplierIdentity(supplier:string){
 const legal=normalize(supplier).replace(/\./g,'').replace(/\s+/g,' ').replace(/\s+(?:s\s*a(?:\s*p\s*i)?|s\s*de\s*r\s*l)\s+de\s+c\s*v$/, '').trim();
 return ({'comercializadora de lacteos y derivados':'lala','hygeia de mexico':'hygeia','ganaderos productores de leche pura':'alpura','distribuidora arca continental':'arca continental','sigma alimentos comercial':'sigma ecommerce','qualtia alimentos operaciones':'qualtia','mission foods mexico':'mission foods'} as Record<string,string>)[legal]??legal;
}
export const supplierKey=(supplier:string,sku:string)=>supplierIdentity(supplier)+'|'+(supplierIdentity(supplier)==='lala'&&/^\d+$/.test(sku)?sku.replace(/^0+(?=\d)/,''):sku.trim());
const size=(s:string)=>[...normalize(s).matchAll(/(\d+(?:\.\d+)?)\s*(kg|ml|gr|g|lt|l)(?=\b|\d|nc\b)/g)].map(m=>`${Number(m[1])*(['kg','l','lt'].includes(m[2])?1000:1)}${['kg','gr','g'].includes(m[2])?'g':'ml'}`);
const flavors=['limon','jamaica','fresa','vainilla','chocolate','integral','multigrano','blanco','dragon','durazno','mango','pavo','cerdo','almendra','coco','nuez'];
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
 const a=size(input.description),b=size(product.name);
 if(a.length&&b.length&&!a.some(x=>b.includes(x)))flags.push('Presentación o contenido distinto');
 const fa=flavors.filter(f=>text.includes(f)),fb=flavors.filter(f=>name.includes(f));
 if(fa.length&&fb.length&&!fa.some(f=>fb.includes(f)))flags.push('Variante o sabor en conflicto');
 if(input.barcode&&product.barcode===input.barcode&&products.filter(p=>p.barcode===input.barcode).length>1)flags.push('Código de barras duplicado en catálogo');
 if(input.supplierSku&&product.supplierSku&&evidence.includes('SKU + proveedor')&&products.filter(p=>p.supplierSku&&supplierKey(p.supplier,p.supplierSku)===supplierKey(input.supplier,input.supplierSku!)).length>1)flags.push('SKU de proveedor ambiguo');
 matches.push({product,evidence,flags,score});
 }
 matches.sort((a,b)=>b.score-a.score);
 if(matches.length>1&&matches[0].score===matches[1].score)matches[0].flags.push('Varios candidatos con la misma evidencia');
 if(matches[0]&&matches.some(m=>m.product.id!==matches[0].product.id&&m.evidence.some(e=>e.includes('exacto')||e==='SKU + proveedor')))matches[0].flags.push('Los identificadores señalan productos distintos');
 return matches.slice(0,8);
}
