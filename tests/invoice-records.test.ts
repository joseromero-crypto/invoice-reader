import {it,expect} from 'vitest';
import {invoiceRecordsFormat,invoiceRecordsToTables,invoiceTablesToRecords} from '../server/invoice-records';
import {encodeInvoiceTableOutput,readInvoiceOutput} from '../server/invoice-output';
const sizes=[{width:100,height:100,sourcePage:1},{width:200,height:200,sourcePage:1,region:{left:0,top:0,width:1,height:1}},{width:100,height:100,sourcePage:2}];
const value={supplier:'Synthetic',reference:'00017',date:'2026-10-30',currency:null,printedPage:null,printedPageCount:null,printedTotal:null,warnings:['~literal'],rows:[1,2].map((n)=>({sourcePage:n,sourceRow:n,supplierSku:'0001',barcode:null,description:'~quoted "item"',quantity:n===1?0:null,unit:'PZ',packContents:4,price:null,discount:null,tax:null,amount:null,rawText:'0001 literal\nitem 0',reception:{kind:'ambiguous',text:'5+?',quantity:null},receptionMarked:false,fieldUncertainties:[{field:'quantity',reason:'uncertain baseline'}],flags:['review quantity']})),annotationEvidence:{rows:[1,2].map(n=>({sourceRow:n,sourcePage:n,inspection:'uncertain',baseline:null})),marks:[{id:'m1',sourcePage:1,kind:'ambiguous',text:'5+?',quantity:null,position:{x:0.5,y:0.5},candidateRows:[1],anchorSupplierSku:'0001',association:'ambiguous'}]},quantityEvidence:{rows:[1,2].map(n=>({sourceRow:n,sourcePage:n,baseline:null})),cells:[{id:'q1',sourcePage:1,text:'0',value:0,position:null,candidateRows:[1],anchorSupplierSku:'0001',association:'ambiguous'}]}};
const tables=()=>encodeInvoiceTableOutput(value,sizes);
const read=(records:unknown)=>readInvoiceOutput({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(records),citations:null}]},sizes);
it('round trips every source/evidence field and coverage through named records without inference',()=>{
 const wire=tables(),records=invoiceTablesToRecords(wire);
 expect(invoiceRecordsToTables(records)).toEqual(wire);expect(read(records)).toEqual(value);
 expect(records.rows[0][2]).toBe('0001');expect(records.rows[0][5]).toBe('0');expect(records.rows[1][5]).toBe('');expect(records.rows[0][4]).toBe('~~quoted "item"');expect(records.coverage.map((r:any)=>r.overviewView)).toEqual(['1','3']);
});
it('constrains mark enums and full-overview references natively while preserving the complete evidence structure',()=>{
 const schema=invoiceRecordsFormat(sizes).schema as any;
 expect(Object.keys(schema.properties).at(-1)).toBe('coverage');expect(schema.additionalProperties).toBe(false);
 expect(schema.properties.rows.items.type).toBe('array');expect(schema.properties.coverage.items.properties.overviewView.enum).toEqual(['1','3']);
 expect(schema.properties.marks.items.properties.kind.enum).not.toContain('number');
 for(const key of ['annotationRows','marks','quantityRows','cells','rowFlags','rowUncertainties'])expect(schema.required).toContain(key);
});
it('rejects omitted/extra fields, malformed list cells and invalid evidence instead of repairing records',()=>{
 const cases:Array<(r:any)=>void>=[r=>{r.rows[0].pop();},r=>{r.rows[0].push('extra');},r=>{r.marks[0].kind='number';},r=>{r.rows[0][5]=-1;},r=>{r.rowFlags[0]=['1',false];},r=>{r.rowUncertainties[0].push('bad-field');},r=>{r.coverage[0].overviewView='2';},r=>{r.cells[0][4]='5000';}];
 for(const mutate of cases){const records=invoiceTablesToRecords(tables());mutate(records);expect(()=>read(records)).toThrow();}
});
