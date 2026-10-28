// Only item identity and quantity problems interrupt the uploaded-page workflow.
const irrelevant=/missing.page|page.*(?:missing|not provided|not supplied|incomplete|cannot confirm)|(?:incomplete|unknown|unverified).*page|(?:printed|total).*page.*(?:unknown|unverified)|page (?:marker|number)|documento incompleto|páginas? sin verificar|número total de páginas|unit prices?|line amounts?|discounts?|subtotal|currency|moneda|importe|precio|taxes|impuestos|printed.*total|handwritten.*check|check.*mark|marca.*(?:recepci|verific)|blue.*mark|clipboard|background|non.invoice content|folio.*also printed|receipt marked preventa/i;
export function operationalWarnings(warnings:string[]){return [...new Set(warnings.filter(w=>{
 if(/quantity|cantidad|item|artículo|clave|sku|barcode|código|descripci|row|fila|alignment|alineaci/i.test(w)&&/unreadable|ilegible|uncertain|inciert|ambiguous|ambigu|mismatch|no coincide|obscur|hidden|ocult/i.test(w))return true;
 if(/photo angle|ángulo|quantities sit|matched in order/i.test(w))return false;
 return !irrelevant.test(w);
}))];}
export const hasReceptionMark=(flags:string[])=>flags.some(f=>!/unclear|ambiguous|uncertain|ilegible|inciert|dudos|unreadable/i.test(f)&&/handwritten[_ ]check[_ ]mark|handwritten.*check mark|marca.*recepci[oó]n/i.test(f));
export function itemFlags(flags:string[],piecesKnown:boolean){return operationalWarnings(flags).filter(f=>!(piecesKnown&&/pack[_ ]contents[_ ]in[_ ]description[_ ]unconfirmed/i.test(f)));}
