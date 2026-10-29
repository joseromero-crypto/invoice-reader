import type {Row} from './domain.ts';
import {hasReceptionConflict} from './receiving-policy.ts';

// A product proposal and a received count are separate decisions. A pending
// reception observation never supplies a default received quantity.
export const hasBilledQuantityUncertainty=(flag:string)=>flag.startsWith('Cantidad facturada pendiente:')||/^quantity:/.test(flag)||/^Cantidad ilegible$/.test(flag)||(!hasReceptionConflict(flag)&&/(?:quantity|cantidad|alignment|alineaci[oó]n)/i.test(flag)&&/(?:uncertain|inciert|ambigu|ilegible|unreadable|conflict|no coincide)/i.test(flag));
export const isQuantityReviewFlag=(flag:string)=>hasReceptionConflict(flag)||hasBilledQuantityUncertainty(flag);
export const needsQuantityInput=(row:Pick<Row,'flags'>)=>row.flags.some(isQuantityReviewFlag);
export function initialReceivedQuantity(row:Row){
 return needsQuantityInput(row)?'':String(row.actualQuantity??row.proposedQuantity??row.billedQuantity??'');
}
export function validReceivedQuantity(value:string){return /^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)<=1_000_000;}
export function quantityReviewMessage(row:Pick<Row,'flags'|'product'|'description'>,name=row.product?.name??row.description){
 if(row.flags.some(hasBilledQuantityUncertainty))return `No se pudo vincular con certeza la cantidad facturada a ${name}. Revisa la factura e indica el número de piezas recibidas físicamente.`;
 if(row.flags.some(f=>/inspección de manuscritos incompleta/.test(f)))return `No se pudo verificar si ${name} tiene anotaciones manuales. Indica el número de piezas recibidas físicamente.`;
 if(row.flags.some(f=>/asociación/.test(f)))return `Hay anotaciones manuales cuya asociación con ${name} es incierta. Indica el número de piezas recibidas físicamente.`;
 return `Se detectaron anotaciones manuales en ${name}. Indica el número de piezas recibidas físicamente.`;
}
