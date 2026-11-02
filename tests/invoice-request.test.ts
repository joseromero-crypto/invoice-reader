import {it,expect} from 'vitest';
import sharp from 'sharp';
import {invoiceRequest,prepareInvoiceImage,invoiceImageSizes} from '../server/invoice-request';
import {invoiceOutputFormat} from '../server/invoice-output';
it('uses the production native contract, photo order and evidence instructions for every request size',()=>{
 const images=[1,2,3].map(n=>({type:'image' as const,source:{type:'base64' as const,media_type:'image/jpeg' as const,data:String(n)}}));
 for(const count of [1,2,3]){
  const body=invoiceRequest('synthetic',images.slice(0,count),'adaptive',images.slice(0,count).map(()=>({width:100,height:100})));
  expect(body.max_tokens).toBe(count>=3?32000:16000);
  expect(body.output_config?.format).toEqual(invoiceOutputFormat());
  const content=body.messages[0].content as any[];
  expect(content.filter(block=>block.type==='image')).toEqual(images.slice(0,count));
  expect(content.at(-1).text).toContain(`these ${count} invoice page images`);
  expect(content.at(-1).text).toContain('COLUMN counts, NEVER item counts');
  expect(content.at(-1).text).not.toContain('rows exactly 17');
  expect(body.system).toContain('annotationEvidence as a separate visual inventory');
  expect(body.system).toContain('quantityEvidence as a separate inventory');
 }
 expect(()=>invoiceRequest('synthetic',[])).toThrow('Invalid page count');
 expect(()=>invoiceRequest('synthetic',Array(9).fill(images[0]))).toThrow('Invalid page count');
 expect(()=>invoiceRequest('synthetic',[{...images[0],source:{...images[0].source,data:'a'.repeat(28_000_001)}}])).toThrow('safe API request size');
});
it('prepares an oriented JPEG within the provider limit and rejects non-photo data before a request',async()=>{
 const original=await sharp({create:{width:100,height:60,channels:3,background:'#fff'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const prepared=await prepareInvoiceImage(original);
 expect(prepared.source.type).toBe('base64');
 if(prepared.source.type!=='base64')throw Error('Expected base64');
 expect(prepared.source.media_type).toBe('image/jpeg');
 expect(prepared.transformations).toEqual({oversized_image:'error'});
 expect(invoiceImageSizes([prepared])).toEqual([{width:60,height:100,quarterTurns:0}]);
 const meta=await sharp(Buffer.from(prepared.source.data,'base64')).metadata();
 expect([meta.width,meta.height]).toEqual([60,100]);
 await expect(prepareInvoiceImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'))).rejects.toThrow('Unsupported image type');
});

it('selects effort from the prepared visual workload while caps still follow original photos',()=>{
 const images=[1,2,3,4,5].map(n=>({type:'image' as const,source:{type:'base64' as const,media_type:'image/jpeg' as const,data:String(n)}}));
 const sizes=images.map((_,i)=>({width:100,height:100,sourcePage:i+1}));
 const short=invoiceRequest('claude-sonnet-5-5',images.slice(0,3),'adaptive',sizes.slice(0,3),3);
 expect(short.output_config?.effort).toBe('high');expect(short.max_tokens).toBe(32000);
 const larger=invoiceRequest('claude-sonnet-5-5',images,'adaptive',sizes,5);
 expect(larger.output_config?.effort).toBe('medium');expect(larger.max_tokens).toBe(32000);
 expect(invoiceRequest('claude-sonnet-5-5',images.slice(0,2),'adaptive',sizes.slice(0,2),2).max_tokens).toBe(16000);
});

it('leaves response headroom for dense rotated details without suppressing either evidence inventory',()=>{
 const images=[1,2,3].map(n=>({type:'image' as const,source:{type:'base64' as const,media_type:'image/jpeg' as const,data:String(n)}}));
 const sizes=[{width:100,height:100,sourcePage:1},...images.slice(1).map(()=>({width:100,height:100,sourcePage:1,dense:true as const,quarterTurns:3 as const,region:{left:0,top:0,width:1,height:1}}))];
 const request=invoiceRequest('claude-sonnet-5-5',images,'adaptive',sizes,1);
 expect(request.output_config?.effort).toBe('medium');expect(request.max_tokens).toBe(16000);expect(request.thinking).toBeUndefined();
 expect(request.system).toContain('annotationEvidence as a separate visual inventory');expect(request.system).toContain('quantityEvidence as a separate inventory');
});

it('retains the full contract and ceilings for Haiku with a bounded low-effort profile',()=>{
 const image={type:'image' as const,source:{type:'base64' as const,media_type:'image/jpeg' as const,data:'synthetic'}};
 const sizes=[{width:1920,height:1080,sourcePage:1}];
 const haiku=invoiceRequest('claude-haiku-5-5',[image],'adaptive',sizes,1),sonnet=invoiceRequest('claude-sonnet-5-5',[image],'adaptive',sizes,1);
 expect(haiku.output_config?.effort).toBe('low');expect(JSON.stringify(haiku.output_config?.format)).toContain('invoice-records-v2');expect(haiku.max_tokens).toBe(16000);expect(haiku.thinking).toBeUndefined();
 expect(String(haiku.system).length).toBeLessThan(String(sonnet.system).length);
 for(const field of ['annotationRows','marks','quantityRows','cells','rowFlags','rowUncertainties','coverage'])expect(JSON.stringify(haiku)).toContain(field);
 expect(haiku.system).toContain('ALL marks and ALL printed billed cells');
 expect(haiku.system).toContain('billed quantity unchanged');
 expect(()=>invoiceRequest('claude-haiku-5-5',[image],'between_tools',sizes,1)).toThrow('requires Sonnet');
});
