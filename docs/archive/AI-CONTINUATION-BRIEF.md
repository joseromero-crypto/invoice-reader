# Restart brief for the next model — 2 November 2026

This is a documentation checkpoint, not another implementation or paid run. The last implementation/measurement session was 30 October 2026, America/Monterrey. On 2 November, all 17 implementation files in `private/testing/basic-sonnet-repair-20261030/verification-final/source-checkpoint.json` still matched their saved SHA-256 hashes. The 229-test result below was read from the saved logs; tests were not rerun for this documentation-only update. No provider call, operational write, deployment or receiving approval was made.

## Where we left off

**We have a working local, supervised invoice-draft workflow. We do not have an accepted production reader.** The code is wired into the worker, but it was not pushed or deployed in this work. Current hosted behavior/version was not checked on 2 November; do not infer that the live application runs these local changes.

The direction is back to basics: one quick Sonnet read of printed supplier data, local catalog matching and quantity selection, then explicit human physical receiving. Large AI-generated geometry and duplicate mark/quantity inventories are intentionally absent from basic mode. Every source photo, literal field, uncertainty, original row reference and failed request remains evidence. A clean model label or valid JSON is not proof of OCR accuracy or complete coverage.

The latest breakthrough was practical: **all four invoices originally refused by our budget gate now complete and parse**, after removing wasteful blanket crops and introducing literal quantity columns plus a simpler strict transport. Those refusals were our affordability decision, not provider refusals. The next bottleneck is source-field/handwriting reliability and receiver workload, rather than just response capacity.

## What works now, locally

- One Sonnet 5.5 request with `thinking: between_tools`, low effort, no tools, standard billing and SDK retries zero. This setting was officially/account verified on 30 October, not reverified on 2 November.
- A complete overview of every original plus bounded ink-based useful detail views. The new profile uses at most 1,600 overview patches and 4,784 combined detail patches per original, with measurable magnification benefit; it keeps EXIF orientation and does not guess text polarity from the ink axis. Details and overview retain provenance. This is a heuristic, not an independent coverage certificate.
- A strict explicit basic source contract, literal quantity headers and aligned source strings. The local selector chooses a unique explicit PIEZAS/PZ column or a sole billed column; it does not infer a case-to-piece conversion, multiply pack contents, or decide that equal numbers establish unit meaning.
- Separate printed data and received counts. Clear quantities remain usable, initially unconfirmed proposals. Specific quantity/ownership doubts start blank. Explicit zero is valid. Source columns remain visible in review; legible but unresolved quantities say “Sin seleccionar.”
- Explicit human bulk physical review for eligible clear proposals; individual review for doubtful rows. A source supplier key conflicting with an exact-barcode catalog candidate requires source-key review unless an existing verified mapping supports the equivalence. This preserves the original source and the local product proposal.
- No AI-only receipt confirmation, including on supposed checks. Strict parsing, local matching, audit, ownership/fencing, duplicate/attempt protections, source/list attestation and unresolved/export safeguards remain. Removing detailed inventories does not activate legacy automatic confirmation or make all basic rows pending.
- A US$0.099 shared document budget, including failures and explicit retries. Reserve exact freely counted input padded by 20% + 1,024 plus maximum allowed output before dispatch. Actual output starts at 6,500 and shrinks to affordability; 16K/32K ceilings remain. Useful minima 2,200/3,200/4,200 are still heuristics. Unknown/interrupted usage retains its reservation; thinking is counted once through output tokens.

## What we cannot claim or do now

- No trustworthy unattended extraction, AI receipt approval or automatic export. Humans still have to check source completeness and physical identity/counts.
- No uniform full-set success for the final prompt. Four v3 reads used successive prompt revisions; **only invoice 12 freshly used the final prompt**. Unpaid replay verifies current parsing/matching, not how a model would reread all photos today.
- No universal exact keys, units, barcodes, descriptions or handwriting ownership. Correct quantities and containment do not make other OCR errors correct.
- No demonstrated net receiver-time saving. Counts of inputs are proxies, not timed human work. A flag can be necessary, unnecessary or missing.
- No demonstrated reliable US$0.05–0.08 average for one frozen full-set configuration. Development cost averaged across changing candidates is not that result.
- No complete in-app manual-entry fallback for an invoice with no accepted rows. Existing per-row review helps valid drafts; “manual handling” of a rejected/truncated document still requires a separate manual process. Do not tell users an end-to-end manual-entry screen already exists.
- No additional paid loop, classification pass, automatic fallback/escalation, relaxed parser, reset job or substitute campaign/job to get around a document limit. A new evidence directory never grants a new allowance.
- No claim that hosted upload/result persistence or rollout acceptance was tested for this final basic candidate. Tasks 3–5 remain queued: compact printed descriptions, precise uncertainty reasons and successful stop-reason persistence. Do not silently expand into them beyond a narrowly necessary receiving/source fix.

## Measured status and the failures that matter

Across the 13 authorized second-round invoices: 12 have complete parsable reads containing 209 rows; invoice 1 has no accepted 29-row read. This combines old basic v1 and several repair revisions. Current audit replay gives **83 clear proposals / 126 pending, all unconfirmed**, 88 physical count inputs and 65 identity/source inputs (overlapping). Zero AI confirmations and zero unsupported exports were observed.

| Invoice | Relevant result / limitation |
|---|---|
| 1 | Verbose response truncated. No accepted 29-row read. Remaining balance cannot fund a useful current request. Manual handling. |
| 3 | Initial basic printed counts were actually correct. Retained v1 misses the cross on actual row 13; the later v2 response sees it but has invalid IDs/ownership references and stays rejected. Both attempts used. Do not salvage/merge it into a new approved result. |
| 4 | Retained old read chooses cases instead of printed pieces on all 31 rows. A flag contains the issue but does not correct it. Remaining balance is inadequate for a useful retry. |
| 5 | New strict read: 28 piece and 28 case values correct, both crosses routed to review. It omits the separate CAJAS units on 28 rows and printed asterisk prefixes from raw text. 25 clear proposals, three individual reviews. |
| 8 | Nine counts/units/barcodes correct; all nine structured supplier keys wrongly contain SAT fiscal codes. Commercial keys remain in descriptions. Current local audit adds nine source-key reviews, retaining clear count proposals. |
| 9 | Eleven counts/keys/units correct; real repeated items separate; fiscal-only third photo accounted for; all three crosses pending. Barcode fields are null on all 11 rows although literal digits remain in source text. One extra false mark/count doubt; five individual count inputs total. |
| 12 | Fourteen keys/barcodes and both quantity columns correctly retained, fiscal-only second photo accounted for. Headers are CAJAS–ZZ / CAJAS–EA, not PIEZAS. Unit/column meaning unresolved: all 14 receiving counts blank. One false mark and 14 unnecessary no-separate-unit doubts remain in original observations; duplicate local warnings were reduced. |

Read the complete per-invoice table in `docs/BASIC-SONNET-REPAIR-RESULTS.md` for the other invoices and all costs. Row count/coverage validation is structural; it cannot detect a consistently omitted row. Earlier retained overlap-boundary, description and handwriting issues remain documented there and in the original private reports.

**Critical correction:** the older invoice 3 evaluation vector was itself shifted. Reopening the original and tracing its sloping baselines showed that initial basic counts were all correct and the historical model had eight wrong values. The earlier basic 108/147 comparison becomes 116/147; the historical “238/238” claim is withdrawn. It would be 230/238 only if all other old assessments held; they were not all reaudited. Do not rewrite old ledgers or repeat their unqualified claims. The additive source adjudication is `private/testing/basic-sonnet-repair-20261030/03-attempt-2/original-photo-adjudication.json`. Correct invoice totals do not prove correct row association.

## Exact spending / attempt boundary

The first basic campaign cost an estimated **US$0.505374**. Repair added **US$0.267386**, including its rejected v2 response. The combined authorized campaign is **US$0.772760**, with 14 dispatched calls, 213,185 input / 34,639 output tokens and zero thinking tokens. All have known returned usage. These are usage-based development estimates, **not verified provider billing**. Historical campaigns remain separately reported and must not be double-counted here.

The overall limit remains US$1.287 and each actual invoice remains capped at US$0.099 / two attempts, including its initial refusal/failed attempt history. Nominal aggregate headroom of US$0.514240 is **not permission to redistribute or reset individual limits**.

- Invoices 3, 5, 8, 9 and 12 have used both attempts. Their immutable `*-attempt-2/spend-final.json` ledgers include earlier generation charges where applicable.
- Invoices 1, 4, 6, 7, 10, 11 and 13 failed useful-request affordability at the last applicable free count snapshot. Any new admission decision must recompute from actual remaining balances and current exact request, not assume a call fits.
- Only invoice 2 was potentially affordable for a second attempt at the last preflight; it has only three rows and cannot establish representative acceptance. The paid repair runner intentionally allows only the already-consumed sequence 3/5/8/9/12; it is not a general retry utility. Do not edit an allowlist or use another harness merely to spend.
- The last saved free preflight predates invoice 12's dispatch: its “admitted / US$0 spent” entry is stale for that document. Current invoice 12 cumulative spend is US$0.054652 and attempt 2 is consumed. Prefer the latest durable per-document ledgers over a preflight summary.

No paid calls are scheduled. This 2 November documentation request authorizes no new generation campaign or expanded limits. If further representative generation becomes necessary, first prepare a concrete frozen candidate and explicit accounting/measurement proposal; obtain authorization for any expansion beyond the existing bounds. Before any otherwise authorized paid check, reverify current official pricing, account availability and request compatibility. Do not present the 30 October provider verification as a current 2 November check.

## What to do next — recommended order, not completed features

1. **Start offline, keep the current checkpoint reproducible.** Read the corrected source adjudication and latest results. Snapshot current changes/evidence, then run the focused source/receiving regressions and historical checks for the proposed change. Never put evaluation answers, expected row counts or catalogs into extraction prompts. Freeze prompt/schema/model/effort/image settings together; later comparisons must identify the one factor changed.
2. **Prioritize the human receiving gap.** Design and implement an explicit human decision for a document-wide ambiguous quantity column/unit, with source labels visible and any conversion verified. Column interpretation is separate from physical receipt approval: it may make a clear proposal usable, but it cannot confirm receipt or manufacture PZ. Individual physical counts must stay blank wherever they remain doubtful. Invoice 12 provides an offline UI/contract case for reducing repeated work; do not assume the improvement saves 14 inputs until it is measured. Also define a real manual-entry path for a failed read with zero usable rows; it is not built yet. These are proposed next features, not current capabilities or approval to write operational records.
3. **Then address source-slot completeness systematically.** Use saved responses and original photos to design generic validation for SAT codes versus commercial keys, visible barcode digits versus an empty barcode field, and separate printed-unit omissions. Preserve literal raw evidence. Flag an inconsistency or offer an explicitly human-reviewed source correction; do not silently fill it from catalog answers, repair invalid provider output into acceptance, or hide OCR errors behind a correct match. Avoid another sequence of paid prompt tweaks without a frozen acceptance protocol.
4. **Make the next acceptance protocol concrete before spending.** Define exact identifiers/units/quantities, all original and overlapping row coverage, repeated items, packs versus boxes, background ownership, handwriting/neighbor ownership, false/missing individual inputs, exports, latency and failure-inclusive cost. Review originals independently and record corrections additively. The original 13-document authorization cannot fund a new uniform rerun of exhausted documents. A larger or fresh validation budget/set needs explicit user authorization; do not create it yourself.
5. **Measure real receiver effort and hosted behavior only when authorized.** Compare clear proposals and specific inputs, correction time, full manual fallback and blocked exports. A timed physical review requires real human input; never invent counts or write approvals to simulate it. Keep rollout on hold until the source-quality, review-scope and integration acceptance criteria actually pass.

The next model should act on a concrete unpaid improvement, not restart the old detailed evidence architecture, claim the cost problem fully solved, or spend immediately on the one small remaining eligible invoice.

## Code map: three version labels are intentional

`invoice-basic-columns-v3` is the native wire format; persisted `readingMode: basic-v2` / `printedReading.version: invoice-basic-columns-v2` is the literal logical source; `basicReading.version: invoice-basic-v1` is the strictly cross-validated common adapter. They are not three competing active production requests. Preserve legacy decoders and source records when changing one layer.

| Area | Files |
|---|---|
| Strict source and local quantity selection | `shared/printed-reading.ts`, `shared/basic-reading.ts` |
| Current native request / decoder | `server/invoice-basic-columns-v3.ts`, `server/invoice-output.ts` |
| Shared logical adapter / retained old transport | `server/invoice-basic-columns.ts`, `server/invoice-basic.ts`, `server/invoice-basic-tables.ts` |
| Full views / local ink details | `server/invoice-image.ts` (`prepareColumnsInvoicePage`; retain old preparers for history) |
| Actual claimed/fenced worker | `server/extract.ts` |
| Matching and basic-specific source/reception audit | `server/match-extraction.ts` |
| Persistent admission accounting | `server/invoice-spend.ts` |
| Receiving and export guards | `shared/domain.ts`, `shared/quantity-review.ts`, `src/Review.tsx`, `src/App.tsx` |
| Focused regressions | `tests/invoice-basic-columns.test.ts`, `tests/invoice-basic.test.ts`, `tests/extract-spend.test.ts`, image/spend tests |

## Read order, evidence and safe commands

Work in `/Users/adrianrodriguez/Desktop/calii-invoice-reader`, not the similarly named Documents workspace. Preserve all modified/untracked files; do not reset, clean, overwrite or stage unrelated work. `HANDOFF.md` and `private/` are ignored; portable documentation is this brief plus the result/plan docs. No commit/push/deploy was made in this work. Existing deployed state and unrelated history are separate.

Read in order:
1. This brief and the newest `HANDOFF.md` section; older sections are historical and contain superseded “plan only,” US$0.05/equal-slot and auto-check descriptions.
2. `docs/BASIC-SONNET-REPAIR-RESULTS.md`, then `docs/BASIC-SONNET-REPAIR-PLAN.md` and `docs/SIMPLE-SONNET-READING-PLAN.md`.
3. `docs/INVOICE-COST-CONTROL.md` and `docs/OUTPUT-CAPACITY-REPAIR.md` for preserved background; do not restore their superseded budget/reader defaults.
4. `private/testing/basic-sonnet-repair-20261030/evaluation-1793408682072.json`, `verification-final/`, per-attempt `inspection.json`, original adjudication and frozen source/request/image/usage files. Older basic evidence: `private/testing/basic-sonnet-20261030/`.
5. Test data ONLY `private/testing/clear-photos-20261028/`: `manifest.json` defines the verified 13 invoices / 24 photos from Archives 9–14 and their hash/order. Never combine a ZIP into an invoice. `REPORT.md`, `independent-photo-quantities.json`, `quantity-accuracy-clarification.md`, `overall-item-accuracy.md`, `overall-item-accuracy-ledger.json` and `row-review.json` are evaluation-only material; read them with the additive invoice 3 correction and reopen originals when uncertain.

Unpaid local commands (from the Desktop repo; do not run `npm ci` just to restart if the existing dependencies work):

```sh
npm test -- tests/invoice-basic-columns.test.ts tests/invoice-basic.test.ts tests/extract-spend.test.ts tests/invoice-image.test.ts tests/invoice-spend.test.ts
npm test
npm run typecheck
npm run build
npm run test:private
node --import tsx scripts/validate-basic-history.ts
node --import tsx scripts/verify-basic-repair.ts
```

The last two create additive private reports; `verify-basic-repair.ts` also writes new matching-audit snapshots. They are unpaid and do not write operational data, but are not read-only filesystem commands. Saved v1 matching comparison excludes earlier documented metadata-only removal of fabricated empty inventories; do not describe that as byte-identical entire row objects. Current v3 audit differences are explicit for invoices 8 and 12.

`basic-repair-preflight.ts` makes free Models/count calls and preserves new prepared requests; it is not generation. `basic-repair-check.ts` is a paid runner, even without a `--send` switch: **do not invoke it as a harmless validation command**. `basic-campaign.ts` and `smoke-invoice.ts` are older paths, not a way around spent document budgets. `evaluate-basic-repair.ts` is evaluation-only and must never be imported into request construction. No API keys, private invoice answers or catalog data belong in portable docs, logs sent externally or prompts.

## Last verified checkpoint and interpretation

30 October: 229 tests / 26 files, build/typecheck/private fixtures pass; existing bundle-size warning only. Historical matching and both detailed codecs cover 37 invoices / 868 rows. Eight basic v1 source parses/matching cores and four v3 source parses replay; current source-key audit adds nine reviews for invoice 8 and reduces duplicate warnings for invoice 12. The malformed v2 remains rejected. All 1,931 private files predating the repair and all 24 original-photo hashes match preservation records. Browser checks used synthetic unconfirmed rows: both source columns visible, doubtful count blank, physical attestation unchecked, confirmation/export blocked. No physical count entered or approval clicked; preview server/tab closed.

2 November: the 17-file final implementation checkpoint was hash-checked unchanged; documentation updated only. Saved test success is not new OCR evidence, full deployed acceptance or a rerun of the final model on all 13 documents.
