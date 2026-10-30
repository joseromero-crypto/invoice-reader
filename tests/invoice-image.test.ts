import {it,expect} from 'vitest';
import sharp from 'sharp';
import {invoiceImageSize,prepareInvoiceImage,invoiceImageSizes,diagnoseInvoiceAxis,prepareInvoicePage} from '../server/invoice-image';
import {invoiceRequest} from '../server/invoice-request';
it('fits the native patch budget as well as both edges, without enlarging images',()=>{
 for(const [w,h] of [[4000,3000],[3000,4000],[10000,100],[100,10000],[2000,2000],[2576,2576],[1,1],[60,100]]){
  const size=invoiceImageSize(w,h);
  expect(size.width).toBeLessThanOrEqual(w);expect(size.height).toBeLessThanOrEqual(h);
  expect(Math.max(size.width,size.height)).toBeLessThanOrEqual(2576);
  expect(Math.ceil(size.width/28)*Math.ceil(size.height/28)).toBeLessThanOrEqual(4784);
 }
 expect(invoiceImageSize(60,100)).toEqual({width:60,height:100});
 expect(invoiceImageSize(1920,1080,'synthetic')).toEqual({width:1456,height:819});
 for(const [w,h] of [[0,100],[-1,100],[NaN,100],[1.5,100]])expect(()=>invoiceImageSize(w,h)).toThrow();
});
it('uses actual oriented unpadded image dimensions in the production pixel request',async()=>{
 const input=await sharp({create:{width:100,height:60,channels:3,background:'#fff'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const image=await prepareInvoiceImage(input);
 const sizes=invoiceImageSizes([image]);expect(sizes).toEqual([{width:60,height:100,quarterTurns:0}]);
 const request=invoiceRequest('claude-sonnet-5-5',[image]);
 expect(request.messages[0].content).toEqual(expect.arrayContaining([image,expect.objectContaining({type:'text',text:expect.stringContaining('"width":60,"height":100')})]));
 expect(request.system).toContain('absolute PIXELS');
 expect(image.transformations).toEqual({oversized_image:'error'});
 expect(()=>invoiceImageSizes([{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'synthetic'}}])).toThrow('coordinate metadata');
 expect(()=>invoiceRequest('claude-sonnet-5-5',[image],'adaptive',[])).toThrow('coordinate metadata');
});

it('diagnoses a sideways text axis locally while leaving upright and blank images alone',async()=>{
 const lines=Array.from({length:14},(_,i)=>`<line x1="20" y1="${43+i*24}" x2="580" y2="${43+i*24}" stroke="black"/><text x="30" y="${35+i*24}" font-size="18">SYNTHETIC ROW ${i} ITEM QUANTITY</text>`).join('');
 const input=await sharp(Buffer.from(`<svg width="600" height="400"><rect width="600" height="400" fill="white"/><g fill="black">${lines}</g></svg>`)).png().toBuffer();
 const upright=await diagnoseInvoiceAxis(input),sideways=await diagnoseInvoiceAxis(await sharp(input).rotate(90).png().toBuffer());
 expect(upright.quarterTurns).toBe(0);expect(sideways.quarterTurns).toBe(3);
 const views=await prepareInvoicePage(await sharp(input).rotate(90).png().toBuffer(),'claude-sonnet-5-5',1,false);
 const overview=invoiceImageSizes(views)[0];expect(overview).toEqual({width:600,height:400,quarterTurns:3,sourcePage:1});
 expect(overview.region).toBeUndefined();
 const blank=await sharp({create:{width:200,height:300,channels:3,background:'white'}}).png().toBuffer();expect((await diagnoseInvoiceAxis(blank)).quarterTurns).toBe(0);
});

it('adds at most two traceable detail views while retaining the complete original and its token ceiling',async()=>{
 const text=Array.from({length:10},(_,i)=>`<text x="300" y="${600+i*65}" font-size="42">SYNTHETIC ITEM ${i} QUANTITY 3</text>`).join('');
 const input=await sharp(Buffer.from(`<svg width="2400" height="3200"><rect width="2400" height="3200" fill="white"/><g fill="black">${text}</g></svg>`)).png().toBuffer();
 const images=await prepareInvoicePage(input,'claude-sonnet-5-5',1),sizes=invoiceImageSizes(images);
 expect(images.length).toBeGreaterThan(1);expect(images.length).toBeLessThanOrEqual(3);
 expect(sizes[0].region).toBeUndefined();expect(sizes.every(s=>s.sourcePage===1)).toBe(true);
 expect(sizes.slice(1).every(s=>s.region&&s.region.width>0&&s.region.height>0)).toBe(true);
 const request=invoiceRequest('claude-sonnet-5-5',images,'between_tools',undefined,1);
 expect(request.max_tokens).toBe(16000);
 expect(()=>invoiceRequest('claude-sonnet-5-5',images,'between_tools',sizes.map(s=>({...s,region:s.region??{left:0,top:0,width:1,height:1}})),1)).toThrow('full original source overview');
});

it('keeps long dense text bands eligible for overlapping detail views instead of selecting only a footer',async()=>{
 const text=Array.from({length:45},(_,i)=>`<text x="100" y="${180+i*65}" font-size="28">SYNTHETIC PRINTED ROW ${i} ITEM QUANTITY 3</text>`).join('');
 const input=await sharp(Buffer.from(`<svg width="2400" height="3200"><rect width="2400" height="3200" fill="white"/><g fill="black">${text}</g></svg>`)).png().toBuffer();
 const images=await prepareInvoicePage(input,'claude-sonnet-5-5',1),sizes=invoiceImageSizes(images);
 expect(images).toHaveLength(3);
 const bounded=await prepareInvoicePage(input,'claude-sonnet-5-5',1,false);expect(bounded).toHaveLength(1);

 expect(sizes.slice(1).every(s=>s.dense===true)).toBe(true);
 const request=invoiceRequest('claude-sonnet-5-5',images,'adaptive',undefined,1);expect(request.output_config?.effort).toBe('high');expect(request.max_tokens).toBe(16000);
 expect(invoiceRequest('claude-sonnet-5-5',images,'between_tools',undefined,1).output_config?.effort).toBe('medium');
 expect(invoiceRequest('synthetic',images,'adaptive',undefined,1).output_config?.effort).toBeUndefined();
 const regions=sizes.slice(1).map(s=>s.region!).sort((a,b)=>a.top-b.top);
 expect(regions[0].top).toBeLessThan(0.1);expect(regions[1].top+regions[1].height).toBeGreaterThan(0.9);
 expect(regions[0].top+regions[0].height).toBeGreaterThan(regions[1].top);
});
