export const HUB_NAMES=['MH Contry','MH Cumbres','MH Guadalupe','MH San Nicolás','MH Avícola','MH Zapopan','MH Condesa','CH Guadalupe'] as const;
export type Hub={id:string;name:string};
export const DEMO_HUBS:Hub[]=HUB_NAMES.map((name,i)=>({id:`demo-hub-${i+1}`,name}));
export type ScanHistoryEntry={id:string;sessionId:string;hubId:string;supplier:string;reference:string;scannedAt:string;invoiceDate:string|null;status:string};
// Calendar dates must never be converted from UTC midnight into the previous local day.
export function invoiceDateLabel(date:string|null|undefined){if(!date)return 'Sin fecha legible';const [y,m,d]=date.split('-');return `${d}/${m}/${y}`;}
export function assertRevision(actual:number,expected:number){if(actual!==expected)throw Error('Otra persona modificó esta fila. Recarga y revisa los cambios antes de confirmar.');}
