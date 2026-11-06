import {strToU8,zipSync} from 'fflate';
// A plain .xlsx: every cell is text unless its column is listed in `numbers`, so Excel can't touch a code (027784 stays
// 027784, a 13-digit barcode doesn't turn into 7.5E+12). A CSV can't promise that.
const xml=(s:string)=>s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const column=(i:number)=>String.fromCharCode(65+i); // this report has fewer than 26 columns
const HEAD='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main',REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships',PKG='http://schemas.openxmlformats.org/package/2006';
export function xlsx(table:string[][],{sheet,widths,numbers=[]}:{sheet:string;widths:number[];numbers?:number[]}):Uint8Array{
 const last=`${column(table[0].length-1)}${table.length}`;
 const cell=(v:string,r:number,c:number)=>{const ref=`${column(c)}${r+1}`;return r>0&&numbers.includes(c)&&/^\d+$/.test(v)?`<c r="${ref}"><v>${v}</v></c>`:`<c r="${ref}" s="${r?1:2}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;};
 const rows=table.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>cell(v,r,c)).join('')}</row>`).join('');
 return zipSync({
  '[Content_Types].xml':strToU8(`${HEAD}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
  '_rels/.rels':strToU8(`${HEAD}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
  'xl/workbook.xml':strToU8(`${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${xml(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  'xl/_rels/workbook.xml.rels':strToU8(`${HEAD}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`),
  // Style 1 = text format, so retyping a cell in Excel keeps it text too. Style 2 = bold text, for the header.
  'xl/styles.xml':strToU8(`${HEAD}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>`),
  'xl/worksheets/sheet1.xml':strToU8(`${HEAD}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${last}"/><ignoredErrors><ignoredError sqref="A1:${last}" numberStoredAsText="1"/></ignoredErrors></worksheet>`),
 });
}
