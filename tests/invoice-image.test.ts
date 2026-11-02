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

it('uses the verified high-resolution image tier for Haiku 5.5 without degrading evidence detail',()=>{
 expect(invoiceImageSize(1920,1080,'claude-haiku-5-5')).toEqual({width:1920,height:1080});
 for(const size of [[4000,3000],[3000,4000],[2576,2576]])expect(invoiceImageSize(size[0],size[1],'claude-haiku-5-5')).toEqual(invoiceImageSize(size[0],size[1],'claude-sonnet-5-5'));
});

it('basic preparation adds bounded overlapping details when the ordinary selector chooses none',async()=>{
 const {prepareBasicInvoicePage}=await import('../server/invoice-image');
 const grid=Array.from({length:40},(_,y)=>Array.from({length:30},(_,x)=>`<rect x="${80+x*128}" y="${80+y*70}" width="38" height="18" fill="black"/>`).join('')).join('');
 const input=await sharp(Buffer.from(`<svg width="4000" height="3000"><rect width="4000" height="3000" fill="white"/>${grid}</svg>`)).jpeg().toBuffer();
 const views=await prepareBasicInvoicePage(input,'claude-sonnet-5-5',1,false),sizes=invoiceImageSizes(views);
 expect(views).toHaveLength(3);expect(sizes[0].region).toBeUndefined();expect(sizes.every(s=>s.sourcePage===1)).toBe(true);
 const regions=sizes.slice(1).map(s=>s.region!);expect(regions[0].left).toBe(0);expect(regions[1].left+regions[1].width).toBe(1);expect(regions[0].left+regions[0].width).toBeGreaterThan(regions[1].left);
});


it('columns planner retains original orientation/full overview and adds one useful ink crop without blind halves',async()=>{
 const {prepareColumnsInvoicePage}=await import('../server/invoice-image');
 const text=Array.from({length:18},(_,i)=>`<text x="300" y="${400+i*80}" font-size="36">SYNTHETIC ITEM ${i} QUANTITY 3</text>`).join('');
 const input=await sharp(Buffer.from(`<svg width="3000" height="2400"><rect width="3000" height="2400" fill="white"/>${text}</svg>`)).png().toBuffer();
 const prepared=await prepareColumnsInvoicePage(input,'claude-sonnet-5-5',2),sizes=invoiceImageSizes(prepared.images);
 expect(sizes[0].region).toBeUndefined();expect(sizes[0].quarterTurns).toBe(0);expect(sizes.every(s=>s.sourcePage===2)).toBe(true);expect(sizes).toHaveLength(2);
 expect(prepared.diagnosis.details[0].gain).toBeGreaterThanOrEqual(1.25);expect(prepared.diagnosis.details[0].inkFraction).toBe(1);
 expect(Math.ceil(sizes[0].width/28)*Math.ceil(sizes[0].height/28)).toBeLessThanOrEqual(1600);
 expect(Math.ceil(sizes[1].width/28)*Math.ceil(sizes[1].height/28)).toBeLessThanOrEqual(4784);
 const crop=sizes[1].region!;expect(crop.left*3000).toBeLessThan(300);expect((crop.top+crop.height)*2400).toBeGreaterThan(400+17*80);
 for(const [i,image] of prepared.images.entries())if(image.source.type==='base64'){const m=await sharp(Buffer.from(image.source.data,'base64')).metadata();expect(m.width).toBe(sizes[i].width);expect(m.height).toBe(sizes[i].height);}
 const again=await prepareColumnsInvoicePage(input,'claude-sonnet-5-5',2);expect(again).toEqual(prepared);
});
it('columns planner does not invent useful detail on blank/native images or guess sideways polarity',async()=>{
 const {prepareColumnsInvoicePage}=await import('../server/invoice-image');
 const blank=await sharp({create:{width:200,height:300,channels:3,background:'white'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const prepared=await prepareColumnsInvoicePage(blank,'claude-sonnet-5-5',1);expect(prepared.images).toHaveLength(1);expect(invoiceImageSizes(prepared.images)[0]).toMatchObject({width:300,height:200,quarterTurns:0});expect(prepared.diagnosis.details).toEqual([]);
 const lines=Array.from({length:14},(_,i)=>`<text x="10" y="${35+i*24}" font-size="18">SYNTHETIC TEXT ROW ${i}</text>`).join('');
 const side=await sharp(Buffer.from(`<svg width="600" height="400"><rect width="600" height="400" fill="white"/>${lines}</svg>`)).rotate(90).png().toBuffer();
 const p=await prepareColumnsInvoicePage(side,'claude-sonnet-5-5',1);expect(invoiceImageSizes(p.images)[0]).toMatchObject({width:400,height:600,quarterTurns:0});expect(p.diagnosis.orientation).toBe('exif-only-polarity-unverified');
});
