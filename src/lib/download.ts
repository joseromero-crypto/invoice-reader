export const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function download(data:string|Uint8Array<ArrayBuffer>,name:string,type='text/csv;charset=utf-8'){const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
