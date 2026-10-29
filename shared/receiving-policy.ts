// Identity, quantity and reception conflicts interrupt the uploaded-page workflow.
const irrelevant=/missing.page|page.*(?:missing|not provided|not supplied|incomplete|cannot confirm)|(?:incomplete|unknown|unverified).*page|(?:printed|total).*page.*(?:unknown|unverified)|page (?:marker|number)|documento incompleto|páginas? sin verificar|número total de páginas|unit prices?|line amounts?|discounts?|subtotal|currency|moneda|importe|precio|taxes|impuestos|printed.*total|handwritten.*check|check.*mark|marca.*(?:recepci|verific)|blue.*mark|clipboard|background|non.invoice content|folio.*also printed|receipt marked preventa/i;
// Reception conflicts must survive the cosmetic mark-warning filter, even when a
// provider also calls the mark a check. A cross/return never confirms receipt.
export const hasReceptionConflict=(flag:string)=>/conflicto[_ ](?:cantidad|recepcion)|c[ií]rculo|\bcircle\b|\bcruz\b|\bcross(?:ed)?\b|tach(?:a|ado|ada|adura)|devolu|devuelt|regres[ao]|faltante|shortage|return(?:ed)?|replacement|recepci[oó]n pendiente|(?:marca|mark).*(?:ambigu|inciert|dudos|unclear|uncertain|ilegible|unreadable|poco clara|no (?:es un check|clara|legible|confirma))/i.test(flag);
export function operationalWarnings(warnings:string[]){return [...new Set(warnings.filter(w=>{
 if(hasReceptionConflict(w))return true;
 if(/quantity|cantidad|item|artículo|clave|sku|barcode|código|descripci|proveedor|supplier|presentaci|sabor|variante|row|fila|alignment|alineaci/i.test(w)&&/unreadable|ilegible|uncertain|inciert|ambiguous|ambigu|mismatch|no coincide|obscur|hidden|ocult|recort|crop|partial|parcial|blur|borros|conflict|contradic/i.test(w))return true;
 if(/photo angle|ángulo|quantities sit|matched in order/i.test(w))return false;
 return !irrelevant.test(w);
}))];}
export const hasReceptionMark=(flags:string[])=>!flags.some(hasReceptionConflict)&&flags.some(f=>!/unclear|ambiguous|uncertain|ilegible|inciert|dudos|unreadable/i.test(f)&&/handwritten[_ ]check[_ ]mark|handwritten.*check mark|marca.*recepci[oó]n/i.test(f));
export function itemFlags(flags:string[],piecesKnown:boolean){return operationalWarnings(flags).filter(f=>!(piecesKnown&&/pack[_ ]contents[_ ]in[_ ]description[_ ]unconfirmed/i.test(f)));}

// Evidence already transcribed by the reader is useful even if its flag was omitted.
// Never infer a mark from a product key, pack multiplier, price or a catalog record.
export function receptionFlags(source:{flags:string[];rawText:string;quantity:number|null;reception?:{kind:string;text:string|null;quantity:number|null}}){
 const flags=[...source.flags],observation=source.reception;
 if(observation){
  const same=observation.kind==='same_quantity'&&observation.quantity!==null&&observation.quantity===source.quantity;
  if(['cross','circle','changed_quantity','return','ambiguous'].includes(observation.kind)||(observation.kind==='same_quantity'&&!same)||(observation.quantity!==null&&observation.quantity!==source.quantity)||(observation.text!==null&&hasReceptionConflict(observation.text)))flags.push(`Recepción pendiente: ${observation.kind}${observation.text?': '+observation.text:''}`);
 }
 const annotations=source.rawText.matchAll(/(?:marca (?:manuscrita|de (?:cruz|recepci[oó]n))|handwritten|manuscrit[oa]|cantidad encerrada|c[ií]rculo|cross(?:ed)? (?:out|mark)|returned item|devoluci[oó]n|faltante)[^;|]*/gi);
 for(const [annotation] of annotations){
  const numeric=/(?:manuscrit[oa]|handwritten(?: quantity| number| sum)?)\s*[:=]?\s*['"]?\s*[+-]?\d/i.test(annotation);
  if(hasReceptionConflict(annotation)||(numeric&&!(observation?.kind==='same_quantity'&&observation.quantity===source.quantity)))flags.push(`Recepción pendiente: ${annotation}`);
 }
 return [...new Set(flags)];
}

// Provider prose reports image evidence; workflow status comes from actual rows.
// Old raw results remain untouched. Do not repeat their unverified status claims.
export function documentWarnings(warnings:string[]){return operationalWarnings(warnings).map(w=>w.replace(/(?:[;,]\s*)?se (?:dej[oó]|dejaron|mantiene|mantienen)\s+(?:pendientes?|confirmad[oa]s?)/gi,'').trim());}
