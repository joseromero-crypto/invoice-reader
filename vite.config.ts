import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import {loadPrivate} from './scripts/private-fixture.ts';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');const root=path.resolve(env.PRIVATE_FIXTURE_ROOT||'private');
 return {plugins:[react(),{name:'private-development-fixtures',apply:'serve',configureServer(server){server.middlewares.use('/__private',async(req,res)=>{
 // Development only, bound to loopback. Never included in preview/build or Netlify.
 if(req.method!=='GET'){res.statusCode=405;res.end();return;}
 try {if(req.url==='/catalog'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({products:loadPrivate(root).products}));return;}if(req.url==='/workspace'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(loadPrivate(root)));return;}
 const file=decodeURIComponent((req.url??'').replace(/^\/image\//,''));if(path.basename(file)!==file||!/^.+\.(jpg|jpeg|png)$/i.test(file))throw Error('Invalid image');
 res.setHeader('Content-Type',file.toLowerCase().endsWith('.png')?'image/png':'image/jpeg');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(path.join(root,'invoices',file)));
 }catch{res.statusCode=404;res.end('Private fixtures unavailable');}
 });}}],server:{host:'127.0.0.1',fs:{deny:['**/private/**','**/.env*']}},build:{sourcemap:false}};
});
