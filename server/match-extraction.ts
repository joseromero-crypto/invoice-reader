import {derivePrintedReading} from '../shared/printed-reading.ts';
import {validateBasicReading} from '../shared/basic-reading.ts';
import {quantityAlignments} from '../shared/quantity-alignment.ts';
import {annotationAssociations} from '../shared/annotation-association.ts';
import {randomUUID} from 'node:crypto';
import {convertQuantity,confirmRow,type Row,type Product,type ExtractionSchema} from '../shared/domain.ts';
import type {z} from 'zod';
import {matchProducts,supplierIdentity,supplierKey,unverifiedSupplierKeyFlag} from '../shared/matching.ts';
import {hasReceptionMark,hasReceptionConflict,itemFlags,receptionFlags} from '../shared/receiving-policy.ts';
type Extraction=z.infer<typeof ExtractionSchema>;
export function buildInvoiceRows(extraction:Extraction,products:Product[],internalProducts:any[]=[],mappings:any[]=[],rules:any[]=[]){
 const basic=extraction.readingMode==='basic-v1'||extraction.readingMode==='basic-v2';
 if((extraction.readingMode==='basic-v2')!==Boolean(extraction.printedReading))throw Error('Printed reading mode/source required');
 if(extraction.printedReading){const derived=derivePrintedReading(extraction.printedReading,extraction.basicReading?.coverage.length??0);if(JSON.stringify(derived.basic)!==JSON.stringify(validateBasicReading(extraction.basicReading,extraction.basicReading?.coverage.length??0)))throw Error('Printed source adapter mismatch');}
 if(basic&&!extraction.basicReading)throw Error('Missing basic reading source');
 if(extraction.basicReading&&!basic)throw Error('Basic reading mode required');
 if(basic&&(extraction.annotationEvidence||extraction.quantityEvidence))throw Error('Basic reading cannot impersonate detailed inventories');
 if(basic)validateBasicReading(extraction.basicReading,extraction.basicReading!.coverage.length);
 const printedRows=new Map(extraction.printedReading?.rows.map(r=>[r.sourceRow,r])),printedTables=new Map(extraction.printedReading?.tables.map(t=>[t.id,t]));
 const basicRows=new Map(extraction.basicReading?.rows.map(r=>[r.sourceRow,r]));
 if(basic&&(basicRows.size!==extraction.rows.length||extraction.rows.some(r=>{const b=basicRows.get(r.sourceRow);return !b||(['sourcePage','supplierSku','barcode','description','quantity','unit','rawText'] as const).some(k=>r[k]!==b[k]);})))throw Error('Basic source adapter mismatch');
 // Basic observations never enter the legacy absent-inventory fallback.
 const associations=basic?new Map(extraction.rows.map(r=>[r.sourceRow,{flags:[] as string[],check:false,marks:[] as string[]}] )):annotationAssociations(extraction);
 const quantities=basic?new Map(extraction.rows.map(r=>[r.sourceRow,{flags:[] as string[],cells:[] as string[],evidence:undefined}])):quantityAlignments(extraction);
 return extraction.rows.map(source=>{
 const candidates=matchProducts({supplier:extraction.supplier??'',supplierSku:source.supplierSku,barcode:source.barcode,description:source.description},products);
 const mapping=mappings.find(m=>supplierIdentity(m.supplier)===supplierIdentity(extraction.supplier??'')&&m.supplier_sku===source.supplierSku);
 if(mapping){const mapped=internalProducts.find(p=>p.id===mapping.product_id);const candidate=mapped?candidates.find(c=>c.product.id===mapped.external_id):undefined;if(candidate){candidate.flags=candidate.flags.filter(flag=>flag!==unverifiedSupplierKeyFlag);candidate.evidence.push('Mapeo confirmado anteriormente');candidate.score+=4;candidates.sort((a,b)=>b.score-a.score);}}
 const best=candidates[0],internal=internalProducts.find(p=>p.external_id===best?.product.id);
 const rule=rules.find(r=>r.product_id===internal?.id&&supplierIdentity(r.supplier)===supplierIdentity(extraction.supplier??'')&&(r.source_unit??'').toLowerCase()===(source.unit??'').toLowerCase());
 // Team policy: an identified catalog item is the counted piece, even when sold as a pack.
 // Missing/PQ labels do not require multiplying contents or blocking an otherwise exact match.
 // Explicit cases and weight/volume still need evidence of the correct quantity column.
 const countLabel=(source.unit??'').toLowerCase().replace(/[().\s]/g,'');
 const identified=best&&best.flags.length===0&&best.evidence.some(e=>['SKU + proveedor','Código de barras exacto','Mapeo confirmado anteriormente'].includes(e));
 const catalogCount=Boolean(identified&&['','pq','pqt','paq','paquete','paquetes','pack','packs','xpk','pieza','piezas','pza','pzas','pz'].includes(countLabel)&&source.quantity!==null&&Number.isInteger(source.quantity));
 const quantityAlignment=quantities.get(source.sourceRow)!;
 const conversion=quantityAlignment.flags.length?{quantity:null,flag:null}:convertQuantity(source.quantity,catalogCount?'PZ':source.unit,best?.product.unit??'unknown',catalogCount?undefined:rule?Number(rule.factor):undefined);
 // PZ refers to the catalog item, including a catalog multipack. Never multiply by contents in its name.
 const piecesKnown=conversion.quantity!==null;
 const association=associations.get(source.sourceRow)!;
 // Preserve raw attribution for audit, but do not display an unverified numeric
 // assignment as a certain correction to this row.
 const localFlags=basic?[]:receptionFlags(source).map(flag=>association.flags.some(f=>f.includes('asociación'))&&hasReceptionConflict(flag)&&/\d/.test(flag)?`Recepción pendiente: anotación atribuida originalmente a esta fila; asociación por verificar (${flag})`:flag);
 const observation=basicRows.get(source.sourceRow),printedSource=printedRows.get(source.sourceRow),quantityTable=printedSource?printedTables.get(printedSource.tableId):undefined;
 if(basic&&!observation)throw Error('Missing basic row source');
 const basicIdentifierFlags=extraction.readingMode==='basic-v2'&&source.supplierSku&&best?.product.supplierSku&&best.evidence.includes('Código de barras exacto')&&!best.evidence.includes('Mapeo confirmado anteriormente')&&supplierIdentity(extraction.supplier??'')===supplierIdentity(best.product.supplier)&&supplierKey(extraction.supplier??'',source.supplierSku)!==supplierKey(best.product.supplier,best.product.supplierSku)?['supplierSku: Clave leída distinta de la clave del catálogo para este código de barras; verifica la clave impresa.']:[];
 const basicFlags=basic?[...(observation!.fieldUncertainties.filter(f=>f.field==='unit'&&!(extraction.readingMode==='basic-v2'&&observation!.fieldUncertainties.some(q=>q.field==='quantity'))).map(f=>`Cantidad facturada pendiente: unidad ${f.reason}`)),...extraction.basicReading!.rows.filter(r=>(r.handwriting.kind==='other'||r.handwriting.kind==='uncertain'||r.handwriting.ownership==='uncertain')&&(r.sourceRow===source.sourceRow||r.handwriting.candidateRows.includes(source.sourceRow))).map(r=>`Recepción pendiente: ${r.handwriting.ownership==='uncertain'?'asociación de anotación incierta':'anotación manuscrita'}${r.handwriting.text?': '+r.handwriting.text:''}`)]:[];
 const sourceFlags=[...basicIdentifierFlags,...localFlags,...association.flags,...quantityAlignment.flags,...basicFlags];
 const check=extraction.annotationEvidence?association.check:(source.reception?source.reception.kind==='check':(source.receptionMarked??hasReceptionMark(sourceFlags)));
 const receptionMarked=!basic&&check&&source.receptionMarked!==false&&!sourceFlags.some(hasReceptionConflict);
 const flags=[...itemFlags(sourceFlags,piecesKnown),...(basic?observation!.fieldUncertainties.filter(f=>f.field!=='unit'):(source.fieldUncertainties??[])).map(f=>`${f.field}: ${f.reason}`),...(best?.flags??['No hay candidato suficiente']),...(conversion.flag&&!(extraction.readingMode==='basic-v2'&&conversion.flag==='Cantidad ilegible'&&observation!.fieldUncertainties.some(f=>f.field==='quantity'))?[conversion.flag]:[])];
 const row:Row={id:randomUUID(),sourceRow:source.sourceRow,sourcePage:source.sourcePage,description:source.description,supplierSku:source.supplierSku,barcode:source.barcode,billedQuantity:source.quantity,billedUnit:source.unit,price:source.price,amount:source.amount,proposedQuantity:conversion.quantity,actualQuantity:null,confirmedQuantity:null,product:best?.product??null,candidates:candidates.map(c=>c.product),evidence:[...(best?.evidence??[]),...(receptionMarked?['Recepción marcada en factura']:[])],flags:[...new Set(flags)],resolvedFlags:[],conversion:extraction.readingMode==='basic-v2'&&source.quantity===null&&observation!.fieldUncertainties.some(f=>f.field==='quantity')?'Columnas impresas conservadas; indica las piezas recibidas en físico.':quantityAlignment.flags.length?'Cantidad facturada leída conservada; asociación con el artículo por verificar.':conversion.flag??(catalogCount?'Cantidad del artículo identificado en catálogo; sin multiplicar el contenido del empaque.':rule?`${source.quantity} × ${rule.factor} = ${conversion.quantity} piezas Calii (conversión verificada).`:`${source.quantity} ${source.unit} = ${conversion.quantity} artículos del catálogo; sin multiplicar el contenido del empaque.`),confirmed:false,receptionMarked,...(basic?{}:{annotationAssociation:association,quantityAlignment})};
 if(!source.supplierSku&&!source.barcode&&candidates.length>1)row.flags.push('Verifica variante: propuesta solo por descripción');
 // User-defined receiving convention: a clear check confirms receipt, but never resolves product/conversion conflicts.
 const confirmed=!basic&&receptionMarked&&row.flags.length===0&&row.product&&Number.isInteger(row.proposedQuantity)?{...confirmRow(row,row.product,row.proposedQuantity!,true),evidence:[...row.evidence,'Cantidad recibida confirmada por marca en factura']}:row;
 return {...confirmed,...(basic?{sourceDetails:{...observation,readingMode:extraction.readingMode,...(extraction.printedReading?{printedSource,quantityTable}:{})}}:{}),raw:{...source,...(basic?{readingMode:extraction.readingMode,...(extraction.printedReading?{printedSource,quantityTable}:{}),basicSource:observation!,handwriting:observation!.handwriting}:{})}};
 });
}
