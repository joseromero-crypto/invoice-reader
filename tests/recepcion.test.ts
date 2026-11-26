import {it,expect,describe} from 'vitest';
import {match,type CatalogItem} from '../lean/match.ts';
import {receptionRows} from '../lean/reception.ts';
import type {Transcription} from '../lean/transcribe.ts';
import {captureRead,checkSession,corsHeaders,hubSlug,hubForSlug,personName,readLabel,workerSignature,signedWorker,type RecEvent} from '../server/recepcion.ts';
import handler from '../netlify/functions/recepcion.ts';

const t:Transcription={supplier:'ARCA CONTINENTAL',documentRef:'DNL 1',date:'16/11/2026',quantityColumns:['CAJAS','PIEZAS'],printedTotals:[],rows:[
 {photo:1,codes:[{header:'CLAVE',value:'001177'},{header:'CVEPROD',value:'50202301'}],description:'TOPO CHICO 1.5L',quantities:['1','12'],unit:null,mark:'none',note:null},
 {photo:1,codes:[{header:'CODIGO',value:'0499'},{header:'Clave Prod. Serv.',value:'50202304'}],description:'DEL VALLE DURAZNO 250ML',quantities:['','4'],unit:null,mark:'none',note:null},
 {photo:1,codes:[{header:'CLAVE',value:'x-77'}],description:'FRUTSI UVA 250ML',quantities:['','18'],unit:null,mark:'none',note:null}]};
const catalog:CatalogItem[]=[
 {id:'a',name:'Agua mineral Topo Chico 1.5L',sku:'ARC-1',supplier:'Arca Continental',supplierSku:'1177',barcodes:['021136010480'],purchaseUnit:'Pieza',perPurchaseUnit:1},
 {id:'b',name:'Jugo de durazno Del Valle 250ml',sku:'ARC-2',supplier:'Arca Continental',supplierSku:'499',barcodes:['7501055335978'],purchaseUnit:'Pieza',perPurchaseUnit:1},
 {id:'c',name:'Jugo de uva Frutsi 250ml',sku:'ARC-3',supplier:'Arca Continental',supplierSku:'309',barcodes:['75001957'],purchaseUnit:'Pieza',perPurchaseUnit:1}];

describe('reception record codes',()=>{
 const rows=receptionRows(t,match(t,catalog,new Map(),{mode:'recepcion'}),catalog);
 it('matchKeys hold the printed codes and the confident product\'s Masterview codes, normalized, never fiscal codes',()=>{
  expect(rows[0]).toMatchObject({sku:'ARC-1',confident:true});
  expect(rows[0].matchKeys.sort()).toEqual(['1177','21136010480']);
  expect(rows[1].matchKeys.sort()).toEqual(['499','7501055335978']);
  expect(rows.flatMap(r=>r.matchKeys).some(k=>k.startsWith('502023'))).toBe(false);
 });
 it('a row with no confident product keeps only its printed codes; candidates carry their codes',()=>{
  expect(rows[2]).toMatchObject({sku:null,confident:false,matchKeys:['X77']});
  expect(rows[2].candidates[0]).toMatchObject({sku:'ARC-3',barcodes:['75001957'],supplierSku:'309'});
 });
 it('without the catalog, candidates still have the fields (empty)',()=>{
  const bare=receptionRows(t,match(t,catalog,new Map(),{mode:'recepcion'}));
  expect(bare[2].candidates[0]).toMatchObject({barcodes:[],supplierSku:null});
 });
});

describe('mh-recibo session check',()=>{
 const hubs=[{id:'1',name:'MH San Nicolás'},{id:'2',name:'MH Cumbres'},{id:'3',name:'Pruebas de facturas'}];
 const id='mh-san-nicolas__pd-arca-continental__2026-11-16__1794846172226',now=Date.parse('2026-11-16T20:00:00Z');
 const ev=(n:number,tipo:string,ts:string,detalle:any=null,hub='mh-san-nicolas'):RecEvent=>({id:n,tipo,hub,ts,receptor:'Aux',detalle});
 const open=ev(1,'abrir','2026-11-16T16:22:53Z');
 it('maps hub slugs 1:1',()=>{
  expect(hubs.map(h=>hubSlug(h.name))).toEqual(['mh-san-nicolas','mh-cumbres','test-hub']);
  expect(hubForSlug(hubs,'test-hub')?.id).toBe('3');expect(hubForSlug(hubs,'mh-contry')).toBeNull();
 });
 it('accepts an open session from today',()=>expect(checkSession(id,[open],hubs,now)).toMatchObject({hub:{id:'1'},receptor:'Aux'}));
 it('refuses a session with no abrir event',()=>expect(()=>checkSession(id,[ev(2,'admin','2026-11-16T17:00:00Z',{accion:'reabrir'})],hubs,now)).toThrow(/no encontrada/));
 it('refuses an abrir from another hub',()=>expect(()=>checkSession(id,[ev(1,'abrir','2026-11-16T16:22:53Z',null,'mh-cumbres')],hubs,now)).toThrow(/no encontrada/));
 it('refuses a session opened more than 24 h ago',()=>expect(()=>checkSession(id,[open],hubs,Date.parse('2026-11-17T16:30:00Z'))).toThrow(/24 horas/));
 it('photos allow a 7-day-old session',()=>{
  expect(checkSession(id,[open],hubs,Date.parse('2026-11-20T16:30:00Z'),7*24).hub.id).toBe('1');
  expect(()=>checkSession(id,[open],hubs,Date.parse('2026-11-24T16:30:00Z'),7*24)).toThrow(/7 días/);
 });
 it('refuses a deleted session, unless reopened after',()=>{
  expect(()=>checkSession(id,[open,ev(5,'admin','2026-11-16T17:00:00Z',{accion:'borrar'})],hubs,now)).toThrow(/borrada/);
  expect(checkSession(id,[open,ev(5,'admin','2026-11-16T17:00:00Z',{accion:'borrar'}),ev(6,'admin','2026-11-16T17:05:00Z',{accion:'reabrir'})],hubs,now).hub.id).toBe('1');
 });
 it('refuses an unknown hub slug',()=>expect(()=>checkSession('mh-luna__pd-x__2026-11-16__1',[open],hubs,now)).toThrow(/desconocido/));
});

describe('CORS and worker signature',()=>{
 const env='https://recibo.example.test, http://127.0.0.1:5500/';
 it('allows only the listed origins',()=>{
  expect(corsHeaders('https://recibo.example.test',env)).toMatchObject({'Access-Control-Allow-Origin':'https://recibo.example.test'});
  expect(corsHeaders('http://127.0.0.1:5500',env)).not.toBeNull();
  expect(corsHeaders('https://evil.example',env)).toBeNull();
  expect(corsHeaders(null,env)).toBeNull();
  expect(corsHeaders('https://recibo.example.test','')).toBeNull();
 });
 it('the function refuses other origins and answers preflight for listed ones',async()=>{
  process.env.MH_RECIBO_ORIGIN=env;
  expect((await handler(new Request('https://x.test/.netlify/functions/recepcion',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'}))).status).toBe(403);
  const pre=await handler(new Request('https://x.test/.netlify/functions/recepcion',{method:'OPTIONS',headers:{origin:'https://recibo.example.test'}}));
  expect(pre.status).toBe(204);expect(pre.headers.get('access-control-allow-origin')).toBe('https://recibo.example.test');
  const bad=await handler(new Request('https://x.test/.netlify/functions/recepcion',{method:'POST',headers:{origin:'https://recibo.example.test'},body:JSON.stringify({action:'start',sessionId:'x',photoCount:20})}));
  expect(bad.status).toBe(400);expect(bad.headers.get('access-control-allow-origin')).toBe('https://recibo.example.test');
  const unknown=await handler(new Request('https://x.test/.netlify/functions/recepcion',{method:'POST',headers:{origin:'https://recibo.example.test'},body:JSON.stringify({action:'borrarTodo'})}));
  expect(unknown.status).toBe(400);
 });
 it('the worker accepts only the signature for that job',()=>{
  process.env.SUPABASE_SECRET_KEY='test-key';
  const req=(sig?:string)=>new Request('https://x.test',{headers:sig?{'x-recepcion-signature':sig}:{}});
  expect(signedWorker(req(),'job-1')).toBe(false);
  expect(signedWorker(req(workerSignature('job-1')),'job-1')).toBe(true);
  expect(()=>signedWorker(req(workerSignature('job-2')),'job-1')).toThrow(/signature/);
 });
});

describe('captura scans in the list',()=>{
 const hub={id:'h',name:'MH Contry',city:'Monterrey'},now=Date.parse('2026-11-17T23:00:00Z');
 const d={id:'d1',created_at:'2026-11-17T22:12:05Z',supplier:'Arca Continental',reference:'DNL 5695688139',invoice_date:'2026-11-17',warnings:[]};
 it('has the reception_reads shape, marked captura, rows left for the rebuild',()=>{
  const r=captureRead(d,{status:'complete',requested_by:'u1',raw_result:{matchedSupplier:'Arca Continental',totalsOk:true,transcription:{supplier:'DISTRIBUIDORA ARCA CONTINENTAL'}}},hub,now);
  expect(r).toMatchObject({read_id:'d1',contract_version:1,hub_name:'MH Contry',status:'done',error:null,supplier:'Arca Continental',printed_supplier:'DISTRIBUIDORA ARCA CONTINENTAL',reference:'DNL 5695688139',totals_ok:true,rows:[],external_ref:null,purpose:'captura',requested_by:'u1'});
 });
 it('status follows the job like the SQL function',()=>{
  expect(captureRead(d,undefined,hub,now).status).toBe('processing');
  expect(captureRead(d,{status:'failed',error:'x'},hub,now)).toMatchObject({status:'failed',error:'x'});
  expect(captureRead(d,{status:'queued',created_at:'2026-11-17T22:50:00Z'},hub,now)).toMatchObject({status:'failed',error:'La lectura no terminó.'});
  expect(captureRead(d,{status:'processing',lease_until:'2026-11-17T23:05:00Z'},hub,now).status).toBe('processing');
 });
 it('labels a read supplier · folio · day · time (Monterrey) · who',()=>{
  expect(readLabel({supplier:'Arca Continental',printed_supplier:null,reference:'DNL 5695688139',created_at:'2026-11-17T22:12:05Z',scanned_by:'José Romero'})).toMatch(/^Arca Continental · DNL 5695688139 · 17 nov · 4:12 p\.?\s?m\.? · José Romero$/);
  expect(readLabel({supplier:null,printed_supplier:'BIMBO S.A.',reference:null,created_at:'2026-11-13T15:05:39Z',scanned_by:null})).toMatch(/^BIMBO S\.A\. · Sin folio · 13 nov · 9:05/);
 });
 it('names the scanner from the Google account',()=>{
  expect(personName({user_metadata:{full_name:'Ana Pérez'},email:'ana@calii.com'})).toBe('Ana Pérez');
  expect(personName({user_metadata:{},email:'ana.perez@calii.com'})).toBe('ana.perez');
  expect(personName(null)).toBeNull();
 });
});
