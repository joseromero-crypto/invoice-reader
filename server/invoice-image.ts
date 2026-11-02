import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import type {InvoiceImageSize} from './invoice-tables';
const dimensions=new WeakMap<Anthropic.ImageBlockParam,InvoiceImageSize>();

// Compute illumination from the SAME normalized raster. Normalizing a second
// blurred image independently changes its contrast and suppresses real text.
function localMeans(data:Uint8Array,width:number,height:number,radius:number){
 const stride=width+1,integral=new Float64Array(stride*(height+1)),result=new Float64Array(width*height);
 for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){row+=data[y*width+x];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;}}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const left=Math.max(0,x-radius),right=Math.min(width,x+radius+1),top=Math.max(0,y-radius),bottom=Math.min(height,y+radius+1);
  result[y*width+x]=(integral[bottom*stride+right]-integral[top*stride+right]-integral[bottom*stride+left]+integral[top*stride+left])/((right-left)*(bottom-top));
 }
 return result;
}
// Fit both the edge AND patch-token limits, not just the longest dimension.
// Never enlarge originals. Reject server downsizing so returned pixels refer
// to exactly this unpadded prepared image, rather than a hidden transformed one.
export function invoiceImageSize(width:number,height:number,model='claude-sonnet-5-5'):InvoiceImageSize{
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)throw Error('Invalid image dimensions');
 const high=/^claude-(?:sonnet|haiku)-5-5(?:-\d{8})?$/.test(model),edge=high?2576:1568,budget=high?4784:1568;
 const fits=(w:number,h:number)=>w<=edge&&h<=edge&&Math.ceil(w/28)*Math.ceil(h/28)<=budget;
 if(fits(width,height))return {width,height};
 let low=0,upper=Math.min(1,edge/width,edge/height);
 for(let i=0;i<60;i++){
  const scale=(low+upper)/2,w=Math.max(1,Math.floor(width*scale)),h=Math.max(1,Math.floor(height*scale));
  if(fits(w,h))low=scale;else upper=scale;
 }
 return {width:Math.max(1,Math.floor(width*low)),height:Math.max(1,Math.floor(height*low))};
}
// Cheap image diagnosis, not an OCR/clean-invoice classification. Compare ink
// projection variance on bright paper; only a strongly vertical text axis is
// rotated. Polarity is not inferred, and every pixel remains in the supplied view.
export async function diagnoseInvoiceAxis(buffer:Buffer){
 const base=sharp(buffer,{limitInputPixels:40_000_000}).autoOrient().resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).grayscale().normalise();
 const {data,info}=await base.clone().raw().toBuffer({resolveWithObject:true});
 const local=localMeans(data,info.width,info.height,5);
 const rows=new Array<number>(info.height).fill(0),columns=new Array<number>(info.width).fill(0);let ink=0;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  const i=y*info.width+x;
  if(data[i]<140&&local[i]>175){rows[y]++;columns[x]++;ink++;}
 }
 const fraction=ink/(info.width*info.height),meanSquared=fraction*fraction;
 const horizontal=Math.max(0,rows.reduce((sum,n)=>sum+(n/info.width)**2,0)/info.height-meanSquared);
 const vertical=Math.max(0,columns.reduce((sum,n)=>sum+(n/info.height)**2,0)/info.width-meanSquared);
 const ratio=horizontal>1e-9?vertical/horizontal:0;
 return {quarterTurns:(fraction>=0.002&&vertical>1e-5&&ratio>1.6?3:0) as 0|3,verticalToHorizontal:ratio,inkFraction:fraction};
}
export async function prepareInvoiceImage(buffer:Buffer,model='claude-sonnet-5-5',quarterTurns:0|3=0):Promise<Anthropic.ImageBlockParam>{
 if(![0,3].includes(quarterTurns))throw Error('Invalid image orientation');
 const metadata=await sharp(buffer,{limitInputPixels:40_000_000}).metadata();
 if(!['jpeg','png'].includes(metadata.format??'')||!metadata.width||!metadata.height)throw Error('Unsupported image type');
 const swap=[5,6,7,8].includes(metadata.orientation??1);
 const originalWidth=swap?metadata.height:metadata.width,originalHeight=swap?metadata.width:metadata.height;
 const width=quarterTurns===3?originalHeight:originalWidth,height=quarterTurns===3?originalWidth:originalHeight;
 const size=invoiceImageSize(width,height,model);
 const prepared=await sharp(buffer,{limitInputPixels:40_000_000}).autoOrient().rotate(quarterTurns===3?-90:0).resize({width:size.width,height:size.height,fit:'fill',withoutEnlargement:true}).jpeg({quality:95}).toBuffer({resolveWithObject:true});
 const image:Anthropic.ImageBlockParam={type:'image',source:{type:'base64',media_type:'image/jpeg',data:prepared.data.toString('base64')},transformations:{oversized_image:'error'}};
 dimensions.set(image,{width:prepared.info.width,height:prepared.info.height,quarterTurns});return image;
}
export function invoiceImageSizes(images:Anthropic.ImageBlockParam[]):InvoiceImageSize[]{
 return images.map(image=>{const size=dimensions.get(image);if(!size)throw Error('Missing prepared-image coordinate metadata');return structuredClone(size);});
}

// Full source views are always kept. Local ink bands supply bounded close-ups;
// this does not classify an invoice as clean or remove any reading safeguard.
export async function prepareInvoicePage(buffer:Buffer,model:string,sourcePage:number,splitDenseBands=true):Promise<Anthropic.ImageBlockParam[]>{
 if(!Number.isSafeInteger(sourcePage)||sourcePage<1||sourcePage>8)throw Error('Invalid original source page');
 let main=await prepareInvoiceImage(buffer,model); // Validate the photo before raster diagnosis.
 const axis=await diagnoseInvoiceAxis(buffer),angle=axis.quarterTurns===3?-90:0;
 if(axis.quarterTurns===3)main=await prepareInvoiceImage(buffer,model,3);
 const mainSize=dimensions.get(main)!;dimensions.set(main,{...mainSize,sourcePage});
 const raw=await sharp(buffer,{limitInputPixels:40_000_000}).autoOrient().rotate(angle).raw().toBuffer({resolveWithObject:true});
 const raster=()=>sharp(raw.data,{raw:{width:raw.info.width,height:raw.info.height,channels:raw.info.channels}});
 const thumb=raster().resize({width:768,height:768,fit:'inside',withoutEnlargement:true}).grayscale().normalise();
 const {data,info}=await thumb.clone().raw().toBuffer({resolveWithObject:true}),local=localMeans(data,info.width,info.height,5);
 const ink:Array<{x:number;y:number}>=[],rowCounts=new Array<number>(info.height).fill(0);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
  const i=y*info.width+x;if(data[i]<185&&local[i]>140&&local[i]-data[i]>20){ink.push({x,y});rowCounts[y]++;}
 }
 const occupied=rowCounts.flatMap((n,y)=>n>=Math.max(2,info.width*0.01)?[y]:[]),groups:number[][]=[];
 for(const y of occupied){const last=groups.at(-1);if(!last||y-last.at(-1)!>Math.max(3,info.height*0.035))groups.push([y]);else last.push(y);}
 const fullScale=Math.min(mainSize.width/raw.info.width,mainSize.height/raw.info.height);
 const candidate=(first:number,last:number)=>{
  const points=ink.filter(p=>p.y>=first&&p.y<=last);if(points.length<20)return null;
  const left=0,top=Math.max(0,Math.floor((first/info.height-0.02)*raw.info.height));
  const right=raw.info.width,bottom=Math.min(raw.info.height,Math.ceil(((last+1)/info.height+0.02)*raw.info.height));
  const width=right-left,height=bottom-top,size=invoiceImageSize(width,height,model),gain=Math.min(size.width/width,size.height/height)/fullScale;
  return gain>=(axis.quarterTurns===3?1.1:1.25)?{left,top,width,height,score:points.length*Math.min(gain,2.5),dense:false}:null;
 };
 const candidates=groups.flatMap(group=>{
  const first=group[0],last=group.at(-1)!;if(last-first<info.height*0.02)return [];
  const whole=candidate(first,last);if(whole)return [whole];
  // A dense long band can fail the magnification threshold as a whole. Split
  // it with overlap instead of discarding its item text in favor of a footer.
  if(!splitDenseBands||last-first<info.height*0.35)return [];
  const middle=(first+last)/2,overlap=(last-first)*0.08;
  return [candidate(first,Math.ceil(middle+overlap)),candidate(Math.floor(middle-overlap),last)].filter((c):c is NonNullable<typeof c>=>c!==null).map(c=>({...c,dense:true}));
 }).sort((a,b)=>b.score-a.score).slice(0,2);
 const views=[main];
 for(const selected of candidates){
  let crop=selected;
  if(splitDenseBands&&!selected.dense&&selected.score>0){
   // Trim empty side margins only after selecting a complete ink band. Keep
   // every detected ink point plus padding, and retain the full source view.
   // Dense splits keep their full width and their already-selected profile.
   const band=ink.filter(p=>p.y/info.height>=selected.top/raw.info.height&&p.y/info.height<=(selected.top+selected.height)/raw.info.height);
   if(band.length){
    const minX=band.reduce((n,p)=>Math.min(n,p.x),info.width),maxX=band.reduce((n,p)=>Math.max(n,p.x),0);
    const left=Math.max(0,Math.floor((minX/info.width-0.04)*raw.info.width));
    const right=Math.min(raw.info.width,Math.ceil(((maxX+1)/info.width+0.04)*raw.info.width));
    if(right-left>=raw.info.width*0.2)crop={...selected,left,width:right-left};
   }
  }
  const size=invoiceImageSize(crop.width,crop.height,model);
  const encoded=await raster().extract({left:crop.left,top:crop.top,width:crop.width,height:crop.height}).resize({width:size.width,height:size.height,fit:'fill',withoutEnlargement:true}).jpeg({quality:95}).toBuffer({resolveWithObject:true});
  const image:Anthropic.ImageBlockParam={type:'image',source:{type:'base64',media_type:'image/jpeg',data:encoded.data.toString('base64')},transformations:{oversized_image:'error'}};
  const region=axis.quarterTurns===3?{left:1-(crop.top+crop.height)/raw.info.height,top:crop.left/raw.info.width,width:crop.height/raw.info.height,height:crop.width/raw.info.width}:{left:crop.left/raw.info.width,top:crop.top/raw.info.height,width:crop.width/raw.info.width,height:crop.height/raw.info.height};
  dimensions.set(image,{width:encoded.info.width,height:encoded.info.height,quarterTurns:axis.quarterTurns,sourcePage,region,...(crop.dense?{dense:true as const}:{})});views.push(image);
 }
 return views;
}

// Basic reads retain the same full overview/detail selector, plus bounded useful
// overlapping detail bands when it selected none. This is free raster work and
// makes no claim about text/mark completeness or polarity of the text axis.
export async function prepareBasicInvoicePage(buffer:Buffer,model:string,sourcePage:number,splitDenseBands=true){
 const views=await prepareInvoicePage(buffer,model,sourcePage,splitDenseBands);
 if(views.length>1||(await diagnoseInvoiceAxis(buffer)).inkFraction<0.002)return views;
 const overview=invoiceImageSizes(views)[0],turn=overview.quarterTurns??0;
 const {data,info}=await sharp(buffer,{limitInputPixels:40_000_000}).autoOrient().rotate(turn===3?-90:0).raw().toBuffer({resolveWithObject:true});
 const scale=Math.min(overview.width/info.width,overview.height/info.height);
 if(scale>=0.85)return views;
 const horizontal=info.width>=info.height,edge=horizontal?info.width:info.height;
 const length=Math.ceil(edge*0.62),starts=[0,edge-length];
 for(const start of starts){
  const crop={left:horizontal?start:0,top:horizontal?0:start,width:horizontal?length:info.width,height:horizontal?info.height:length};
  const size=invoiceImageSize(crop.width,crop.height,model);
  if(Math.min(size.width/crop.width,size.height/crop.height)<scale*1.1)continue;
  const imageData=await sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}}).extract(crop).resize({width:size.width,height:size.height,fit:'fill',withoutEnlargement:true}).jpeg({quality:95}).toBuffer();
  const image:Anthropic.ImageBlockParam={type:'image',source:{type:'base64',media_type:'image/jpeg',data:imageData.toString('base64')},transformations:{oversized_image:'error'}};
  const region=turn===3?{left:1-(crop.top+crop.height)/info.height,top:crop.left/info.width,width:crop.height/info.height,height:crop.width/info.width}:{left:crop.left/info.width,top:crop.top/info.height,width:crop.width/info.width,height:crop.height/info.height};
  dimensions.set(image,{width:size.width,height:size.height,quarterTurns:turn,sourcePage,region});views.push(image);
 }
 return views;
}


export type BasicImageDiagnosis={sourcePage:number;width:number;height:number;axis:Awaited<ReturnType<typeof diagnoseInvoiceAxis>>;orientation:'exif-only-polarity-unverified';inkPoints:number;details:Array<{region:NonNullable<InvoiceImageSize['region']>;gain:number;inkFraction:number}>};
function boundedSize(width:number,height:number,edge:number,patches:number){
 let low=0,high=Math.min(1,edge/width,edge/height);
 const fits=(scale:number)=>Math.ceil(Math.max(1,Math.floor(width*scale))/28)*Math.ceil(Math.max(1,Math.floor(height*scale))/28)<=patches;
 if(fits(high))low=high;else for(let i=0;i<60;i++){const scale=(low+high)/2;if(fits(scale))low=scale;else high=scale;}
 return {width:Math.max(1,Math.floor(width*low)),height:Math.max(1,Math.floor(height*low))};
}
// New basic-only candidate. Historical view preparation above stays reproducible.
// EXIF fixes camera orientation. Ink projection detects an axis, never text polarity:
// do not rotate an original 90 degrees based on an unsupported polarity guess.
export async function prepareColumnsInvoicePage(buffer:Buffer,model:string,sourcePage:number){
 if(!/^claude-sonnet-5-5(?:-\d{8})?$/.test(model)||!Number.isInteger(sourcePage)||sourcePage<1||sourcePage>8)throw Error('Invalid columns image request');
 const metadata=await sharp(buffer,{limitInputPixels:40_000_000}).metadata();
 if(!['jpeg','png'].includes(metadata.format??'')||!metadata.width||!metadata.height)throw Error('Unsupported image type');
 const {data,info}=await sharp(buffer,{limitInputPixels:40_000_000}).autoOrient().raw().toBuffer({resolveWithObject:true});
 const raster=()=>sharp(data,{raw:{width:info.width,height:info.height,channels:info.channels}});
 const axis=await diagnoseInvoiceAxis(buffer),overviewSize=boundedSize(info.width,info.height,1536,1600);
 async function view(crop:{left:number;top:number;width:number;height:number}|null,size:{width:number;height:number}){
  const pipeline=crop?raster().extract(crop):raster();
  const encoded=await pipeline.resize({...size,fit:'fill',withoutEnlargement:true}).jpeg({quality:95}).toBuffer();
  const image:Anthropic.ImageBlockParam={type:'image',source:{type:'base64',media_type:'image/jpeg',data:encoded.toString('base64')},transformations:{oversized_image:'error'}};
  const region=crop?{left:crop.left/info.width,top:crop.top/info.height,width:crop.width/info.width,height:crop.height/info.height}:undefined;
  dimensions.set(image,{...size,sourcePage,quarterTurns:0,...(region?{region}:{})});return image;
 }
 const images=[await view(null,overviewSize)];
 const thumb=await raster().resize({width:768,height:768,fit:'inside',withoutEnlargement:true}).grayscale().normalise().raw().toBuffer({resolveWithObject:true});
 const local=localMeans(thumb.data,thumb.info.width,thumb.info.height,8),points:Array<{x:number;y:number}>=[];
 for(let y=0;y<thumb.info.height;y++)for(let x=0;x<thumb.info.width;x++){
  const i=y*thumb.info.width+x;
  if(thumb.data[i]<185&&local[i]>140&&local[i]-thumb.data[i]>20)points.push({x,y});
 }
 const diagnosis:BasicImageDiagnosis={sourcePage,width:info.width,height:info.height,axis,orientation:'exif-only-polarity-unverified',inkPoints:points.length,details:[]};
 if(points.length<20)return {images,diagnosis};
 const pad=.035,box={left:Math.max(0,Math.floor((points.reduce((n,p)=>Math.min(n,p.x),thumb.info.width)/thumb.info.width-pad)*info.width)),top:Math.max(0,Math.floor((points.reduce((n,p)=>Math.min(n,p.y),thumb.info.height)/thumb.info.height-pad)*info.height)),right:Math.min(info.width,Math.ceil(((points.reduce((n,p)=>Math.max(n,p.x),0)+1)/thumb.info.width+pad)*info.width)),bottom:Math.min(info.height,Math.ceil(((points.reduce((n,p)=>Math.max(n,p.y),0)+1)/thumb.info.height+pad)*info.height))};
 const crop={left:box.left,top:box.top,width:box.right-box.left,height:box.bottom-box.top};
 const fullScale=Math.min(overviewSize.width/info.width,overviewSize.height/info.height);
 const size=invoiceImageSize(crop.width,crop.height,model),gain=Math.min(size.width/crop.width,size.height/crop.height)/fullScale;
 // One ink-bounded detail, only with measurable gain. No blind overlapping halves.
 // If a whole-region detail remains severely downsampled, two overlapping regions
 // replace it, with the same combined patch budget and each retaining visible ink.
 let crops=[crop],patchBudget=4784;
 const detailScale=Math.min(size.width/crop.width,size.height/crop.height);
 if(detailScale<.55&&Math.max(crop.width,crop.height)/Math.min(crop.width,crop.height)>1.7){
  const horizontal=crop.width>=crop.height,edge=horizontal?crop.width:crop.height,length=Math.ceil(edge*.58);
  crops=[0,edge-length].map(start=>({left:crop.left+(horizontal?start:0),top:crop.top+(horizontal?0:start),width:horizontal?length:crop.width,height:horizontal?crop.height:length}));patchBudget=2392;
 }
 for(const selected of crops){
  const detail=boundedSize(selected.width,selected.height,2576,patchBudget);
  const detailGain=Math.min(detail.width/selected.width,detail.height/selected.height)/fullScale;
  const n=points.filter(p=>p.x/thumb.info.width>=selected.left/info.width&&p.x/thumb.info.width<=(selected.left+selected.width)/info.width&&p.y/thumb.info.height>=selected.top/info.height&&p.y/thumb.info.height<=(selected.top+selected.height)/info.height).length;
  if(detailGain<1.25||n<20)continue;
  images.push(await view(selected,detail));diagnosis.details.push({region:invoiceImageSizes([images.at(-1)!])[0].region!,gain:detailGain,inkFraction:n/points.length});
 }
 // Large originals must not silently become overview-only because a split failed.
 if(images.length===1&&gain>=1.25){images.push(await view(crop,size));diagnosis.details.push({region:invoiceImageSizes([images.at(-1)!])[0].region!,gain,inkFraction:1});}
 return {images,diagnosis};
}
