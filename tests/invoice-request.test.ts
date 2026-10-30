import {it,expect} from 'vitest';
import sharp from 'sharp';
import {invoiceRequest,prepareInvoiceImage} from '../server/invoice-request';
import {invoiceOutputFormat} from '../server/invoice-output';
it('uses the production native contract, photo order and evidence instructions for every request size',()=>{
 const images=[1,2,3].map(n=>({type:'image' as const,source:{type:'base64' as const,media_type:'image/jpeg' as const,data:String(n)}}));
 for(const count of [1,2,3]){
  const body=invoiceRequest('synthetic',images.slice(0,count));
  expect(body.max_tokens).toBe(count>=3?32000:16000);
  expect(body.output_config?.format).toEqual(invoiceOutputFormat());
  const content=body.messages[0].content as any[];
  expect(content.slice(0,count)).toEqual(images.slice(0,count));
  expect(content[count].text).toContain(`these ${count} invoice page images`);
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
 const meta=await sharp(Buffer.from(prepared.source.data,'base64')).metadata();
 expect([meta.width,meta.height]).toEqual([60,100]);
 await expect(prepareInvoiceImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'))).rejects.toThrow('Unsupported image type');
});
