// Benchmark the lean reader on the 13 verified test invoices.
//
//   node --experimental-strip-types scripts/lean-bench.ts --model claude-sonnet-5-5 --run sonnet-v1
//   node --experimental-strip-types scripts/lean-bench.ts --run sonnet-v1 --replay     (free: rematch saved reads)
//
// Paid reads go to private/lean-bench/<run>/NN-read.json. Total spend across ALL runs is tracked in
// private/lean-bench/spend.json and the script refuses to start a call past --budget (default $3).
// Ground truth: private/testing/clear-photos-20261028 (row-review.json, independent-photo-quantities.json,
// invoice 3 corrected by the original-photo adjudication). Ground truth never goes into the prompt.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { transcribe, type ReadResult } from '../lean/transcribe.ts';
import { prepareImage } from '../lean/image.ts';
import { match, normCode, type Proposal } from '../lean/match.ts';
import { loadCatalogCsv } from '../lean/catalog.ts';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k: string) => process.argv.includes(`--${k}`);
const ROOT = process.cwd();
const GT = join(ROOT, 'private/testing/clear-photos-20261028');
const OUT = join(ROOT, 'private/lean-bench');
const run = arg('run') ?? 'run';
const model = arg('model', process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5')!;
const budget = parseFloat(arg('budget', '3')!);
const only = arg('invoices')?.split(',').map(Number);
const concurrency = parseInt(arg('concurrency', '4')!);
mkdirSync(join(OUT, run), { recursive: true });

// ---------- inputs ----------
const manifest = JSON.parse(readFileSync(join(GT, 'manifest.json'), 'utf8'));
const photoPath = new Map<string, string>();
for (const g of manifest.groups) for (const p of g.photos) photoPath.set(p.filename, join(GT, 'invoices', p.path.split('/invoices/')[1]));
const invoices: { n: number; ref: string; photos: string[] }[] = [];
for (const g of manifest.groups) for (const u of g.actualUploadOrder) invoices.push({ n: u.invoice, ref: u.reference, photos: u.orderedPhotos.map((f: string) => photoPath.get(f)!) });
invoices.sort((a, b) => a.n - b.n);

const catalogFile = join(ROOT, 'private/catalog/table-data - 2026-10-27T161019.962.csv');
const catalog = loadCatalogCsv(catalogFile);

const review: any[] = JSON.parse(readFileSync(join(GT, 'row-review.json'), 'utf8'));
const vectors = JSON.parse(readFileSync(join(GT, 'independent-photo-quantities.json'), 'utf8')).vectors;
const adj = join(ROOT, 'private/testing/basic-sonnet-repair-20261030/03-attempt-2/original-photo-adjudication.json');
if (existsSync(adj)) vectors['3'] = JSON.parse(readFileSync(adj, 'utf8')).photoAdjudicatedVector;

// ---------- spend guard ----------
const spendFile = join(OUT, 'spend.json');
const spend = existsSync(spendFile) ? JSON.parse(readFileSync(spendFile, 'utf8')) : { totalUsd: 0, calls: [] as any[] };
const saveSpend = () => writeFileSync(spendFile, JSON.stringify(spend, null, 2));

// ---------- scoring ----------
function score(n: number, proposals: Proposal[]) {
  const exp = review.filter(r => r.invoice === n).sort((a, b) => a.sourceRow - b.sourceRow);
  const qv: number[] = vectors[String(n)] ?? [];
  const used = new Set<number>();
  const rows = exp.map((e, i) => {
    const key = normCode(e.supplierKey ?? '');
    let j = proposals.findIndex((p, k) => !used.has(k) && p.item?.id === e.catalogId);
    if (j < 0 && key) j = proposals.findIndex((p, k) => !used.has(k) && p.row.codes.some(c => normCode(c.value) === key));
    if (j < 0 && i < proposals.length && !used.has(i)) j = i;
    if (j >= 0) used.add(j);
    const p = proposals[j];
    return {
      row: e.sourceRow, expectedId: e.catalogId, expectedName: e.catalogName, expectedQty: qv[i] ?? e.printedQuantityPhoto,
      gotId: p?.item?.id ?? null, gotName: p?.item?.name ?? null, gotQty: p?.quantity ?? null, status: p?.status ?? 'missing',
      mark: p?.row.mark ?? null, reasons: p?.reasons ?? ['fila no leída'], basis: p?.quantityBasis ?? '',
      idOk: !!p && p.item?.id === e.catalogId, qtyOk: !!p && p.quantity === (qv[i] ?? e.printedQuantityPhoto),
    };
  });
  return { expected: exp.length, read: proposals.length, extra: proposals.length - used.size, rows };
}

async function one(inv: typeof invoices[number]) {
  const file = join(OUT, run, `${String(inv.n).padStart(2, '0')}-read.json`);
  let read: ReadResult & { model?: string };
  if (flag('replay') || existsSync(file)) {
    if (!existsSync(file)) return null;
    read = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    if (spend.totalUsd >= budget) { console.log(`#${inv.n}: skipped, budget $${budget} reached`); return null; }
    const images = await Promise.all(inv.photos.map(p => prepareImage(readFileSync(p)))); // same prep as server/extract.ts
    read = { ...(await transcribe(process.env.ANTHROPIC_API_KEY!, model, images)), model };
    spend.totalUsd += read.costUsd; spend.calls.push({ run, invoice: inv.n, model, usd: read.costUsd, usage: read.usage, at: new Date().toISOString() }); saveSpend();
    writeFileSync(file, JSON.stringify(read, null, 2));
  }
  const m = read.transcription ? match(read.transcription, catalog) : { supplier: null, proposals: [], totalsOk: null, warnings: ['lectura fallida'] };
  const s = score(inv.n, m.proposals);
  writeFileSync(join(OUT, run, `${String(inv.n).padStart(2, '0')}-match.json`), JSON.stringify({ supplier: m.supplier, totalsOk: m.totalsOk, warnings: m.warnings, proposals: m.proposals, score: s }, null, 2));
  return { inv, read, m, s };
}

const results: any[] = [];
const queue = invoices.filter(i => !only || only.includes(i.n));
await Promise.all(Array.from({ length: concurrency }, async () => { while (queue.length) { const r = await one(queue.shift()!); if (r) results.push(r); } }));
results.sort((a, b) => a.inv.n - b.inv.n);

// ---------- report ----------
let tot = { exp: 0, id: 0, qty: 0, both: 0, ok: 0, okWrong: 0, usd: 0, sec: 0 };
const lines = [`# Lean bench — ${run} (${results[0]?.read.model ?? model})`, '', '| # | Ref | Supplier | Rows exp/read | Identity ✓ | Qty ✓ | Both ✓ | Auto-ok rows | Auto-ok but wrong | USD | Sec | Notes |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const { inv, read, m, s } of results) {
  const id = s.rows.filter((r: any) => r.idOk).length, q = s.rows.filter((r: any) => r.qtyOk).length, both = s.rows.filter((r: any) => r.idOk && r.qtyOk).length;
  const ok = s.rows.filter((r: any) => r.status === 'ok').length, okWrong = s.rows.filter((r: any) => r.status === 'ok' && !(r.idOk && r.qtyOk)).length;
  tot.exp += s.expected; tot.id += id; tot.qty += q; tot.both += both; tot.ok += ok; tot.okWrong += okWrong; tot.usd += read.costUsd; tot.sec += read.seconds;
  lines.push(`| ${inv.n} | ${inv.ref} | ${m.supplier ?? '?'} | ${s.expected}/${s.read} | ${id} | ${q} | ${both} | ${ok} | ${okWrong} | ${read.costUsd.toFixed(4)} | ${read.seconds.toFixed(0)} | ${read.error ?? ''}${m.totalsOk === false ? ' TOTAL≠' : m.totalsOk ? ' total✓' : ''} |`);
}
lines.push(`| **Total** | | | ${tot.exp} | ${tot.id} | ${tot.qty} | ${tot.both} | ${tot.ok} | ${tot.okWrong} | ${tot.usd.toFixed(4)} | ${tot.sec.toFixed(0)} | |`, '', `Cumulative spend across all lean runs: $${spend.totalUsd.toFixed(4)} (budget $${budget}).`, '', '## Misses', '');
for (const { inv, s } of results) for (const r of s.rows) if (!r.idOk || !r.qtyOk)
  lines.push(`- #${inv.n} row ${r.row}: expected ${r.expectedName} ×${r.expectedQty} | got ${r.gotName ?? '—'} ×${r.gotQty ?? '—'} [${r.status}; ${r.basis}; ${r.reasons.join('; ')}]`);
writeFileSync(join(OUT, run, 'REPORT.md'), lines.join('\n'));
console.log(lines.slice(0, 20 + results.length).join('\n'));
