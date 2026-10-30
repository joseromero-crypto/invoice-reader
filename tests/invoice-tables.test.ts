import {it,expect} from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {encodeInvoiceTableOutput,readInvoiceOutput,invoiceOutputFormat} from '../server/invoice-output';
import {invoiceRequest} from '../server/invoice-request';
const source={supplier:'~ Supplier',reference:'00012',date:'2024-02-29',currency:null,printedPage:1,printedPageCount:null,printedTotal:'null',warnings:['#0','+','~','~~text'],
 annotationEvidence:{rows:[{sourceRow:1,sourcePage:1,inspection:'complete',baseline:null}],marks:[{id:'m1',sourcePage:1,kind:'ambiguous',text:'  0 + ? " \\ \n ñ ',quantity:null,position:{x:0.123456789,y:1},candidateRows:[1],anchorSupplierSku:'0012',association:'certain'}]},
 quantityEvidence:{rows:[{sourceRow:1,sourcePage:1,baseline:{start:{x:0,y:0.1},end:{x:0.9,y:0.2}}}],cells:[{id:'q1',sourcePage:1,text:'00',value:0,position:{x:1,y:0.21},candidateRows:[1],anchorSupplierSku:'0012',association:'certain'}]},
 rows:[{sourcePage:1,sourceRow:1,supplierSku:'0012',barcode:'0000000000001',description:'  Synthetic " \\ product  ',quantity:0,unit:'PZ',packContents:4,price:null,discount:null,tax:null,amount:null,rawText:'~~ [] {} null true 0012\n',reception:{kind:'ambiguous',text:'0 + ?',quantity:null},fieldUncertainties:[{field:'quantity',reason:'Fuente sin resolver.'}],receptionMarked:false,flags:['Recepción pendiente.']}]};
const response=(tables:unknown)=>({stop_reason:'end_turn' as const,content:[{type:'text' as const,text:JSON.stringify(tables),citations:null}]});
const read=(tables:unknown)=>readInvoiceOutput(response(tables));
it('preserves every original type/value and independent inventory with native record boundaries',()=>{
 const tables=encodeInvoiceTableOutput(source);
 expect(tables.version).toBe('invoice-tables-v3');expect(tables.rows[0][2]).toBe('0012');expect(tables.rows[0][5]).toBe('0');
 expect(tables.meta[0]).toBe('~~ Supplier');expect(tables.warnings).toContain('~~~text');
 expect(read(tables)).toEqual(source);
 expect(read({invoice:JSON.stringify(source)})).toEqual(source);
});
it('rejects missing, unknown, mixed-type and wrong-column tables',()=>{
 const original=encodeInvoiceTableOutput(source);
 for(const key of Object.keys(original)){const bad:any=structuredClone(original);delete bad[key];expect(()=>read(bad)).toThrow();}
 expect(()=>read({...original,extra:[]})).toThrow();expect(()=>read({...original,version:'invoice-tables-v4'})).toThrow();
 for(const name of ['meta','rows','annotationRows','quantityRows']){
  const bad:any=structuredClone(original);const values=name==='meta'?bad.meta:bad[name][0];values.pop();expect(()=>read(bad)).toThrow();
 }
 const mixed:any=structuredClone(original);mixed.rows[0][5]=0;expect(()=>read(mixed)).toThrow();
});
it('requires explicit per-row uncertainty and flag observations, even when empty',()=>{
 const original=encodeInvoiceTableOutput(source);
 for(const name of ['rowFlags','rowUncertainties'] as const){
  for(const records of [[],[['2']],[[...original[name][0]],[...original[name][0]]]])expect(()=>read({...original,[name]:records})).toThrow();
 }
 const pairs=structuredClone(original);pairs.rowUncertainties[0].pop();expect(()=>read(pairs)).toThrow();
 for(const key of ['annotationEvidence','quantityEvidence']){const bad:any=structuredClone(source);delete bad[key];expect(()=>encodeInvoiceTableOutput(bad)).toThrow();}
 for(const key of ['reception','receptionMarked','fieldUncertainties']){const bad:any=structuredClone(source);delete bad.rows[0][key];expect(()=>encodeInvoiceTableOutput(bad)).toThrow();}
});
it('enforces original numeric/calendar/enum/geometry rules and atomic nullable positions',()=>{
 const mutations=[(x:any)=>x.rows[0][5]='-1',(x:any)=>x.meta[2]='2026-02-29',(x:any)=>x.rows[0][13]='approved',(x:any)=>x.rows[0][16]='0',(x:any)=>x.marks[0][5]='1.1',(x:any)=>x.marks[0][5]='~',(x:any)=>x.cells[0][3]='0x1',(x:any)=>x.cells[0][3]='1e999',(x:any)=>x.rows[0][2]='~bad',(x:any)=>x.quantityRows[0][2]='~'];
 for(const mutate of mutations){const bad=encodeInvoiceTableOutput(source);mutate(bad);expect(()=>read(bad)).toThrow();}
 const empty=encodeInvoiceTableOutput(source);empty.rows=[];empty.rowFlags=[];empty.rowUncertainties=[];expect(()=>read(empty)).toThrow();
});
it('rejects partial/refused responses and does not promote complete-looking rows from them',()=>{
 const valid=response(encodeInvoiceTableOutput(source));
 for(const stop_reason of ['refusal','max_tokens'] as const)expect(()=>readInvoiceOutput({...valid,stop_reason})).toThrow();
 expect(()=>readInvoiceOutput({...valid,content:[{...valid.content[0],text:valid.content[0].text.slice(0,-1)}]})).toThrow();
});
it('uses the actual SDK with a small native table schema and bounded model-specific reasoning',async()=>{
 const sizes=[{width:100,height:100}];let sent:any,calls=0;
 const client=new Anthropic({apiKey:'synthetic-key',maxRetries:0,timeout:180000,fetch:async(_url,init)=>{calls++;sent=JSON.parse(String(init?.body));return Response.json({id:'synthetic',type:'message',role:'assistant',model:'claude-sonnet-5-5',...response(encodeInvoiceTableOutput(source,sizes)),stop_sequence:null,usage:{input_tokens:10,output_tokens:20}});}});
 const images=[{type:'image' as const,source:{type:'base64' as const,media_type:'image/jpeg' as const,data:'synthetic'}}];
 const result=await client.messages.create(invoiceRequest('claude-sonnet-5-5',images,'between_tools',sizes));
 expect(calls).toBe(1);expect(sent.max_tokens).toBe(16000);expect(sent.thinking).toEqual({type:'between_tools'});
 expect(sent.output_config.format).toEqual(invoiceOutputFormat());expect(sent.output_config.format.schema.properties.rows.items.items).toEqual({type:'string'});
 expect(JSON.stringify(sent.output_config.format.schema).length).toBeLessThan(2048);expect(readInvoiceOutput(result,sizes)).toEqual(source);
});

it('requires trusted image sizes for pixel output and normalizes without quantization or clamping',()=>{
 const sizes=[{width:1000,height:2000}],tables=encodeInvoiceTableOutput(source,sizes);
 expect(tables.version).toBe('invoice-tables-v7-compact');
 expect(tables.marks[0][5]).toBe(String(0.123456789*1000));
 expect(()=>read(tables)).toThrow('image pixel dimensions');
 const value=readInvoiceOutput(response(tables),sizes);
 expect(value.rows).toEqual(source.rows);expect(value.annotationEvidence!.marks[0].position!.x).toBeCloseTo(0.123456789,14);
 expect(value.annotationEvidence!.marks[0].position!.y).toBe(1);
 const outside=structuredClone(tables);outside.marks[0][5]='1001';expect(()=>readInvoiceOutput(response(outside),sizes)).toThrow();
 expect(()=>readInvoiceOutput(response(tables),[])).toThrow();
 expect(()=>readInvoiceOutput(response(tables),[{width:0,height:2000}])).toThrow();
});

it('maps every pixel evidence point back through trusted rotations to the original oriented source',()=>{
 for(const quarterTurns of [0,1,2,3] as const){
  const sizes=[{width:1000,height:2000,quarterTurns}],tables=encodeInvoiceTableOutput(source,sizes),decoded=readInvoiceOutput(response(tables),sizes);
  expect(decoded.rows).toEqual(source.rows);
  expect(decoded.annotationEvidence!.marks[0].position!.x).toBeCloseTo(source.annotationEvidence.marks[0].position.x,14);
  expect(decoded.annotationEvidence!.marks[0].position!.y).toBeCloseTo(source.annotationEvidence.marks[0].position.y,14);
  expect(decoded.quantityEvidence!.rows[0].baseline!.end.x).toBeCloseTo(0.9,14);
 }
});

it('restores close-up coordinates and view references to the authoritative original photo',()=>{
 const value=structuredClone(source);value.annotationEvidence.marks[0].position={x:0.3,y:0.4};
 const sizes=[{width:1000,height:2000,sourcePage:1},{width:800,height:1600,sourcePage:1,quarterTurns:3 as const,region:{left:0.1,top:0.1,width:0.8,height:0.8}}];
 const tables=encodeInvoiceTableOutput(value,sizes);tables.marks[0][1]='2';tables.marks[0][5]='300';tables.marks[0][6]='1200';
 const decoded=readInvoiceOutput(response(tables),sizes);
 expect(decoded.rows[0].sourcePage).toBe(1);
 const badSource=structuredClone(tables);badSource.rows[0][0]='2';expect(()=>readInvoiceOutput(response(badSource),sizes)).toThrow('full source overview');
 const outside=structuredClone(tables);outside.marks[0][5]='801';expect(()=>readInvoiceOutput(response(outside),sizes)).toThrow('outside supplied view');
 expect(decoded.annotationEvidence!.marks[0].sourcePage).toBe(1);
 expect(decoded.annotationEvidence!.marks[0].position!.x).toBeCloseTo(0.3,14);expect(decoded.annotationEvidence!.marks[0].position!.y).toBeCloseTo(0.4,14);
 expect(()=>readInvoiceOutput(response(tables),sizes.map(s=>({...s,region:{left:0.9,top:0,width:0.8,height:1}})))).toThrow();
});

it('requires complete per-original coverage including non-item pages and rejects skipped supplier rows',()=>{
 const sizes=[{width:1000,height:2000,sourcePage:1},{width:1000,height:2000,sourcePage:2}],wire=encodeInvoiceTableOutput(source,sizes);
 expect(wire.coverage).toEqual([['1','complete','items','1','1'],['2','complete','non_items','0']]);
 expect(readInvoiceOutput(response(wire),sizes)).toEqual(source);
 const variants=[(x:any)=>delete x.coverage,(x:any)=>x.coverage.pop(),(x:any)=>x.coverage[1][1]='incomplete',(x:any)=>x.coverage[0].splice(3,2,'0'),(x:any)=>x.coverage[0][3]='2',(x:any)=>x.coverage[1]=['2','complete','items','1','999'],(x:any)=>x.coverage.push(x.coverage[0])];
 for(const mutate of variants){const bad=structuredClone(wire);mutate(bad);expect(()=>readInvoiceOutput(response(bad),sizes)).toThrow();}
 // A repeated photograph can reference the same physical row without duplicating it.
 const overlap=structuredClone(wire);overlap.coverage![1]=['2','complete','items','1','1'];expect(readInvoiceOutput(response(overlap),sizes).rows).toHaveLength(1);
});

it('uses token-efficient blank null cells while preserving known empty text and literal sentinel strings exactly',()=>{
 const value=structuredClone(source);value.supplier='';value.reference='~';value.rows[0].description='~ literal';
 const sizes=[{width:1,height:1}],wire=encodeInvoiceTableOutput(value,sizes);
 expect(wire.meta[0]).toBe('~');expect(wire.meta[1]).toBe('~~');expect(wire.meta[3]).toBe('');expect(wire.rows[0][8]).toBe('');
 expect(wire.annotationRows[0].slice(3)).toEqual(['','','','']);
 expect(readInvoiceOutput(response(wire),sizes)).toEqual(value);
});

it('places the coverage audit after source/evidence rather than forcing future row-reference planning',()=>{
 const schema=invoiceOutputFormat().schema;expect(Object.keys(schema.properties).at(-1)).toBe('coverage');expect(schema.required.at(-1)).toBe('coverage');
});
