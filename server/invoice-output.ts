import {columnsTransportVersion,decodePrintedTables,readPrintedOutput} from './invoice-basic-columns';
import {columnsV3Version,readPrintedOutputV3} from './invoice-basic-columns-v3';
import type Anthropic from '@anthropic-ai/sdk';
import {basicTransportVersion,decodeBasicTables} from './invoice-basic-tables';
import {readBasicOutput} from './invoice-basic';
import {invoiceRecordVersion,invoiceRecordsToTables} from './invoice-records';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {ExtractionSchema} from '../shared/domain';
import {assertInvoiceShape} from './invoice-shape';
import {invoiceTablesFormat,invoiceTableColumns,encodeInvoiceTables,decodeInvoiceTables,type InvoiceImageSize} from './invoice-tables';
import {decodeInvoiceTransport,invoiceTransportContract} from './invoice-transport';
// Saved results remain backward compatible. Fresh DETAILED reads retain mandatory
// inventories; basic reads have their own explicit strict source validator.
// Fresh reads always report these observations, using kind=none, [] and false
// only when supported by inspection. Legacy domain parsing stays optional.
const FreshRowSchema=ExtractionSchema.shape.rows.element.required({reception:true,fieldUncertainties:true,receptionMarked:true});
const FreshExtractionSchema=ExtractionSchema.omit({readingMode:true,basicReading:true,printedReading:true}).required({annotationEvidence:true,quantityEvidence:true}).extend({rows:FreshRowSchema.array().min(1)});
// Full native domain schemas exceeded the provider grammar limit. Compile
// only small native string tables; restore and validate every original
// source/evidence field locally before matching or persistence.
const sourceSchema=zodOutputFormat(FreshExtractionSchema).schema;
// Checking the original layout also makes domain/schema drift fail before a call.
const transportContract=invoiceTransportContract(sourceSchema,true);
export function encodeInvoiceTableOutput(value:unknown,imageSizes?:InvoiceImageSize[]){assertInvoiceShape(sourceSchema,value);return encodeInvoiceTables(FreshExtractionSchema.parse(value),imageSizes);}
export const invoiceOutputFormat=invoiceTablesFormat;
export function invoiceExtractionInstructions(pages:number,imageSizes?:InvoiceImageSize[]){return `Extract these ${pages} invoice page images in order. Return all visible supplier rows and warnings. Both independent evidence inventories and explicit per-row reception observations are mandatory. Return ONLY the complete native object with version "invoice-tables-v7-compact" and all ten data fields. meta and warnings are JSON arrays of strings. coverage and every other field are JSON arrays of records, each record itself an array of strings. Use the exact column order below; do not omit a column, invent a value, or add financial/catalog reconstruction. All scalar cells are JSON STRINGS: decimal strings for numbers, "true"/"false" for booleans, and exact source text for text fields, including leading zeros, whitespace and punctuation. Unknown nullable cells are "" (the empty JSON string), saving repeated null-marker tokens. A genuine known empty source TEXT is encoded as "~", distinct from null. If a literal source STRING starts with ~, add one leading ~: source "~" becomes "~~", source "~~abc" becomes "~~~abc". Thus source empty text becomes "~"; null becomes ""; literal source "~" becomes "~~". Do not put JSON documents or comma-separated lists inside cells. Ordinary JSON escaping of source quotes/backslashes/newlines happens ONCE. Native arrays provide all record/list boundaries. Fixed columns must all appear even when null. Variable trailing columns are separate scalar cells, in their original order. meta has exactly 7 scalar cells. COLUMN COUNTS WITHIN EACH INDIVIDUAL RECORD: each item record in the rows table contains exactly 17 cells; each annotationRows record contains exactly 7 cells; each quantityRows record contains exactly 6 cells. These are COLUMN counts, NEVER item counts or limits on the number of records. The rows TABLE contains as many item records as the COMPLETE original invoice requires, across ALL original photos. Never stop at 17 items. Each marks record has its 9 fixed cells then candidateRows as trailing cells; each cells record has its 8 fixed cells then candidateRows. rowFlags and rowUncertainties must each explicitly include ONE record for EVERY source row: rowFlags is [sourceRow, ...flags], including [sourceRow] when no flags; rowUncertainties is [sourceRow, field, reason, ...additional field/reason pairs], including [sourceRow] only after inspecting all fields and finding no uncertainty. Do not omit these explicit empty observations. Reception kind/text/quantity and receptionMarked are explicit columns on every item row; never derive them from another table. Unknown baselines use four "" coordinate cells together, unknown positions use two "" cells together. Keep both independent inventories: annotationRows/marks and quantityRows/cells must be visually read independently, never copied from row decisions. Preserve every annotation, printed billed cell, exact identifier, source description, quantity, coordinate, flag and uncertainty; All baseline and position coordinates are absolute PIXELS in the unpadded prepared image, not fractions or 0..1000 values. Keep exact pixel values. The server normalizes by trusted image dimensions locally; never normalize them yourself. Annotation text fields contain only literal handwritten characters: a non-textual tick has text "". Never put a description such as "check beside a printed quantity" in a text field or rawText as if it were handwritten digits. Do not return nested objects, field names inside records, placeholders, markdown or explanations. Encoding example only: ${JSON.stringify({meta:['','0001','','','','',''],rowFlags:[['1']]})}. The example is INCOMPLETE, not an invoice. Your result must include version, all ten data fields, all source rows and complete evidence. Image VIEW coordinate spaces: sourcePage in every returned table is the 1-based VIEW index below, not the original-photo number. Multiple views may show the SAME original photo. The server maps view coordinates and references back to the original sourcePage using trusted metadata. Extract each physical supplier row ONCE, preserving original-photo order then printed row order; overlapping close-ups are not extra pages or extra item occurrences. Item rows MUST reference a full source overview view; independent annotation/quantity evidence may reference a close-up of the SAME original photo. Use the clearest valid view for each evidence record. A close-up may show background sheets: establish supplier-receipt provenance from the full overview before using any crop text or marks. Never treat clearer background/catalog rows as supplier items, even when visible in a detail view. All coordinates must be in that chosen VIEW, not normalized or manually mapped. Full source overviews are retained for coverage and context: ${JSON.stringify(imageSizes??[])}. Coverage is a mandatory FINAL audit AFTER all item and evidence tables: ONE coverage record for EVERY original-photo full overview, including fiscal/non-item photos and repeated/overlapping photos. After extracting all source rows, independently inspect each complete original photo again and count its visible physical supplier rows; link EVERY visible occurrence to its returned sourceRow. Finish the entire source/evidence read before emitting this final audit, rather than predicting future row references upfront. coverage columns are [overviewView, inspection, contentKind, visibleSupplierRowCount, ...visibleSourceRows]. inspection is complete only after the entire original photo was read; otherwise incomplete. contentKind is items when any supplier rows are visible, otherwise non_items. visibleSupplierRowCount must equal the number of distinct trailing sourceRow references. Each returned row must appear in the coverage of its source original. A repeated/overlapping physical row appears in the coverage of each photo where it is visible but is extracted only ONCE. Never call an unread or skipped item page non_items or complete. All original photos must be fully accounted for; do not stop after the first page or return a partial invoice to save work. Do not summarize pages or use a warning instead of their rows. Record columns:\n${Object.entries(invoiceTableColumns).map(([name,fields])=>name+' = ['+fields.join(', ')+']').join('\n')}\nwarnings = [warning, ...]\nOriginal domain schema types and constraints (brackets here show original object field meanings; map them to the named tables above):\n${transportContract}`;}
// Keep the user's hard output ceilings. Selected effort still permits adaptive thinking;
// it is not a hard reservation for JSON and must be validated on fresh photos.
// Model-specific controls are never copied onto arbitrary configured models.
export type InvoiceReasoning='adaptive'|'between_tools'|'disabled';
export function invoiceRequestOptions(pages:number,model='claude-sonnet-5-5',thinking:InvoiceReasoning='adaptive',effort:'medium'|'high'='medium'):Pick<Anthropic.MessageCreateParamsNonStreaming,'max_tokens'|'thinking'|'output_config'>{
 if(!Number.isInteger(pages)||pages<1||pages>8)throw Error('Invalid page count');
 const sonnet55=/^claude-sonnet-5-5(?:-\d{8})?$/.test(model);
 if(thinking==='between_tools'&&!sonnet55)throw Error('between_tools requires Sonnet 5.5');
 const haiku55=/^claude-haiku-5-5(?:-\d{8})?$/.test(model);
 if(thinking==='disabled'&&!haiku55)throw Error('disabled thinking requires Haiku 5.5');
 const reasoning=haiku55?{effort:thinking==='disabled'?'high' as const:'low' as const}:sonnet55?{effort}:{};
 return {max_tokens:pages>=3?32000:16000,...(thinking==='between_tools'?{thinking:{type:'between_tools' as const}}:thinking==='disabled'?{thinking:{type:'disabled' as const}}:{}),output_config:{...reasoning,format:invoiceOutputFormat()}};
}
// Failed output stays private in extraction_jobs; never turn partial JSON into receiving rows.
export function invoiceOutputEvidence(response:Pick<Anthropic.Message,'stop_reason'|'content'>){return {stopReason:response.stop_reason,textBlocks:response.content.filter(block=>block.type==='text').map(block=>block.text)};}
export function readInvoiceOutput(response:Pick<Anthropic.Message,'stop_reason'|'content'>,imageSizes?:InvoiceImageSize[],expectedMode?:'basic-v1'|'basic-v2'|'basic-v3'):ReturnType<typeof ExtractionSchema.parse>{
 if(response.stop_reason!=='end_turn')throw Error('Extraction did not complete');
 const text=response.content.filter(block=>block.type==='text');
 if(text.length!==1)throw Error('Missing or ambiguous structured output');
 const native=JSON.parse(text[0].text);
 if(expectedMode==='basic-v3'&&native?.version!==columnsV3Version)throw Error('Expected explicit v3 printed-column contract');
 if(expectedMode==='basic-v2'&&![columnsTransportVersion,columnsV3Version].includes(native?.version))throw Error('Expected explicit printed-column contract');
 if(native?.version===columnsV3Version){if(expectedMode==='basic-v1')throw Error('Expected explicit basic reading contract');if(!imageSizes?.length)throw Error('Basic source photos required');return readPrintedOutputV3(native,imageSizes);}
 if(expectedMode==='basic-v1'&&native?.version===columnsTransportVersion)throw Error('Expected explicit basic reading contract');
 if(native?.version===columnsTransportVersion){if(!imageSizes?.length)throw Error('Basic source photos required');return readPrintedOutput(decodePrintedTables(native),imageSizes);}
 if(expectedMode==='basic-v1'&&!['invoice-basic-v1',basicTransportVersion].includes(native?.version))throw Error('Expected explicit basic reading contract');
 if(native?.version===basicTransportVersion){if(!imageSizes?.length)throw Error('Basic source photos required');return readBasicOutput(decodeBasicTables(native),imageSizes);}
 if(native?.version==='invoice-basic-v1'){if(!imageSizes?.length)throw Error('Basic source photos required');return readBasicOutput(native,imageSizes);}
 const envelope=native?.version===invoiceRecordVersion?invoiceRecordsToTables(native):native;
 let value:unknown;
 if(envelope&&typeof envelope==='object'&&!Array.isArray(envelope)&&Object.hasOwn(envelope,'version'))value=decodeInvoiceTables(envelope,imageSizes);
 else {
  // Historical full-object and v1 tuple envelopes keep their original strict path.
  if(envelope===null||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).length!==1||typeof envelope.invoice!=='string')throw Error('Invalid invoice envelope');
  const inner=JSON.parse(envelope.invoice);value=Array.isArray(inner)?decodeInvoiceTransport(inner):inner;
 }
 assertInvoiceShape(sourceSchema,value);
 return FreshExtractionSchema.parse(value);
}
