// A PDF becomes one JPG per page here, so the upload, the bucket and the worker only ever see images.
// Same long edge as lean/image.ts: the worker wouldn't keep more.
const MAX_EDGE=2576,QUALITY=.9;
export const isPdf=(bytes:Uint8Array)=>String.fromCharCode(...bytes.slice(0,5))==='%PDF-';
export const pageScale=(width:number,height:number)=>MAX_EDGE/Math.max(width,height);
export async function pdfPages(file:File,maxPages:number):Promise<File[]>{
 // Loaded only when someone picks a PDF. The legacy build runs on older phones.
 const [pdfjs,worker]=await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'),import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')]);
 pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
 const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
 try{
  const pdf=await task.promise.catch((e:Error)=>{throw Error(e.name==='PasswordException'?'El PDF tiene contraseña. Quítala o sube fotos.':'No se pudo abrir el PDF.');});
  if(pdf.numPages>maxPages)throw Error(`El PDF tiene ${pdf.numPages} páginas. Máximo ${maxPages} páginas de la misma factura.`);
  const name=file.name.replace(/\.pdf$/i,''),pages:File[]=[];
  for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n),size=page.getViewport({scale:1}),viewport=page.getViewport({scale:pageScale(size.width,size.height)});
   const canvas=document.createElement('canvas');canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
   await page.render({canvas,viewport,background:'#ffffff'}).promise;
   const blob=await new Promise<Blob|null>(done=>canvas.toBlob(done,'image/jpeg',QUALITY));if(!blob)throw Error('No se pudo convertir el PDF.');
   pages.push(new File([blob],`${name} p${n}.jpg`,{type:'image/jpeg'}));page.cleanup();canvas.width=canvas.height=0;
  }
  return pages;
 }finally{await task.destroy();}
}
