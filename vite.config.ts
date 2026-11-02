import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import {loadPrivate} from './scripts/private-fixture.ts';
import {catalogItem,match} from './lean/match.ts';
import {leanRows} from './server/lean-rows.ts';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');const root=path.resolve(env.PRIVATE_FIXTURE_ROOT||'private');
 return {plugins:[react(),{name:'private-development-fixtures',apply:'serve',configureServer(server){server.middlewares.use('/__private',async(req,res)=>{
 // Development only, bound to loopback. Never included in preview/build or Netlify.
 if(req.method!=='GET'){res.statusCode=405;res.end();return;}
 try {if(req.url==='/catalog'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({products:loadPrivate(root).products}));return;}if(req.url==='/workspace'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');const workspace=loadPrivate(root);
 // Saved lean bench reads (private/lean-bench/<run>/NN-read.json), matched with the current lean/match.ts. No AI call.
 const run=env.PRIVATE_LEAN_RUN||'sonnet-v2',dir=path.join(root,'lean-bench',run);
 if(path.basename(run)===run&&fs.existsSync(dir)){
 const products=workspace.products.map(p=>{const c=catalogItem(p.raw??{});return {...p,purchaseUnit:c.purchaseUnit,perPurchaseUnit:c.perPurchaseUnit};});
 const items=products.map(p=>({...catalogItem(p.raw??{}),id:p.id,name:p.name,sku:p.sku}));
 workspace.products=products;workspace.documents=fs.readdirSync(dir).filter(f=>/^\d+-read\.json$/.test(f)).sort().flatMap(f=>{const t=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')).transcription;if(!t)return [];const result=match(t,items);
 return [{id:`lean-${f.slice(0,2)}`,supplier:result.supplier??t.supplier??'',reference:t.documentRef??f,invoiceDate:null,image:null,pages:1,expectedPages:null,warnings:result.warnings,printedTotal:null,rows:leanRows(t,result,products).map(({raw,...row})=>({...row,sourceDetails:{...raw}}))}];});
 }
 res.end(JSON.stringify(workspace));return;}
 const file=decodeURIComponent((req.url??'').replace(/^\/image\//,''));if(path.basename(file)!==file||!/^.+\.(jpg|jpeg|png)$/i.test(file))throw Error('Invalid image');
 res.setHeader('Content-Type',file.toLowerCase().endsWith('.png')?'image/png':'image/jpeg');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(path.join(root,'invoices',file)));
 }catch{res.statusCode=404;res.end('Private fixtures unavailable');}
 });}}],server:{host:'127.0.0.1',fs:{deny:['**/private/**','**/.env*']}},build:{sourcemap:false}};
});
