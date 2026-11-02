# Basic Sonnet repair results — 30 October 2026

The repair is implemented and validated locally. All four originally refused documents now have complete strict reads. **Production quality acceptance remains FAIL.** Source errors, excess manual work and two documents without a useful affordable correction remain. No push, deployment, receiving record or physical approval was written.

## Implemented behavior

The explicit logical source contract preserves quantity headers once per table and literal aligned cells per row, commercial keys, barcodes, descriptions, raw text, handwriting observations, original-photo/row references and structural coverage. Native `invoice-basic-columns-v3` uses numeric table IDs and named handwriting records; the failed v2 delimiter layout remains strictly rejected. Local selection prefers one explicit printed piece column. Ambiguous columns stay unselected; neither equal values nor EA-like text authorizes an inferred piece unit or pack multiplier. Logical source/common adapters are cross-validated. Historical detailed and basic v1 decoding remains available; no empty detailed evidence is manufactured.

Basic mode uses Sonnet 5.5 `between_tools`, low effort, standard billing, no tools and zero SDK retries. All original overviews remain. The basic-only image planner preserves EXIF orientation, uses a <=1,600-patch overview plus <=4,784 combined detail patches, selects ink-bounded details with >=1.25 magnification gain, and removes blind overlapping half-page fallback. Axis diagnosis cannot establish text polarity. It is a raster heuristic, not proof that faint text, background ownership or handwriting was fully read. Current count checks used all 24 originals; paid repair checks reopened ten originals, with nine yielding four accepted reads.

Human review shows each literal printed quantity column and separate printed row unit when supplied. Legible but unselected counts say “Sin seleccionar.” Specific count/ownership doubts start blank; zero is valid. Clear counts remain usable proposals, initially unconfirmed. Exact barcode matches retain their local product proposal, but a conflicting source supplier key now requires individual source-key review unless a prior verified mapping supports it. This never rewrites the source key. All basic checks remain unconfirmed, regardless of supposed ticks. Explicit bulk physical review, original/list attestation, unresolved/export safeguards, ownership, fences, duplicate protection and existing attempt limits remain.

The shared US$0.099 document allowance reserves free exact input count padded by 20% + 1,024 tokens plus the maximum permitted output before dispatch. Actual output starts at 6,500 and is reduced to fit the remaining balance; hard ceilings stay 16K/32K. Conservative minima 2,200/3,200/4,200 remain heuristics. Known failures count their usage; unknown usage retains its reservation. No attempt or job was reset. No automatic classification, retry, fallback or escalation exists.

## Paid repair checks, inspected sequentially

| Invoice | Native format | Parse result | Input / output tokens | Generation latency | Est. added USD |
|---|---|---|---:|---:|---:|
| 3 | invoice-basic-columns-v2 | strictly rejected | 8,259 / 1,601 | 13.41s | $0.032528 |
| 5 | invoice-basic-columns-v3 | complete | 15,206 / 3,726 | 21.36s | $0.067672 |
| 8 | invoice-basic-columns-v3 | complete | 15,467 / 1,659 | 13.09s | $0.047524 |
| 9 | invoice-basic-columns-v3 | complete | 21,995 / 2,102 | 18.04s | $0.065010 |
| 12 | invoice-basic-columns-v3 | complete | 15,636 / 2,338 | 16.06s | $0.054652 |

Generation latency runs from durable dispatch to captured response. The saved successful count-through-matching latencies were 25.07s, 16.14s, 21.22s and 19.39s respectively, excluding image preparation/account checks. No receiver timing study was performed. Changes were investigated before the next paid check: v2 invalid references → native IDs/handwriting; missing separate units → unit instruction; SAT keys → identifier instruction plus local conflict audit; missing barcode fields → barcode instruction. **These are successive prompt revisions, not a frozen five-document comparison.** Only invoice 12 freshly used the final prompt. Later source-review/wording changes were validated by unpaid replay; accepted source parsing and local product/count proposals remain identical.

- **3:** response completed but invalid table IDs and missing ownership references fail strict parsing. No rows were salvaged. Added cost $0.032528; cumulative document cost $0.062632; both attempts used. The cross on actual row 13 was correctly seen in this rejected response, but that does not repair the retained v1 result.
- **5:** all 28 piece values and 28 case values match reopened originals; 15+13 rows, numeric commercial keys and both crosses are correct. Separate CAJAS row units were omitted on all 28 rows, and source-prefix asterisks were dropped from raw text. These remain OCR errors. 25 clear proposals, three individual reviews (two actual crosses plus one catalog-unmatched item).
- **8:** all nine counts, PAQUETE units and product barcodes match originals; XPK remains literal in raw text. All nine supplierSku fields incorrectly contain fiscal classification codes, while commercial keys remain in descriptions. The final local source audit requires nine identity/source-key reviews, retaining all nine count proposals. The original paid rows are preserved separately from this audit replay.
- **9:** all 11 counts, commercial keys and PAQUETE units match originals; repeated items remain distinct, and the third fiscal-only photo is accounted for. All three crosses are pending. Barcode fields are null on all 11 rows although exact digits remain in descriptions/raw text. One clear tick is called other and receives an unnecessary quantity doubt; two rows lack a catalog proposal. Six clear proposals, five individual count inputs.
- **12:** all 14 keys/barcodes and both 14-cell numeric columns match originals; the fiscal-only second photo is retained. Both literal headings say CAJAS, with ZZ/EA suffixes; there is no printed PIEZAS heading or separate row unit. No PZ unit is fabricated. All 14 receiving counts remain blank until human input; equal numeric values do not certify unit meaning. One clear tick is misread as other and 14 no-separate-unit observations are unnecessarily called doubts. Duplicate generic count/unit warnings are suppressed locally, with original observations retained.

## Important correction to earlier accuracy claims

I relied too heavily on the old evaluation vector when reporting eight shifted quantities in basic invoice 3. Upright reinspection of the original and tracing its sloping row baselines shows that the **initial basic quantities were all correct**. The historical model/result vector has eight shifted values. Original ledgers and results remain unchanged; an additive photo adjudication records the correction. The historical “238/238” claim is withdrawn: it would become 230/238 if every other old assessment held, and those other old rows were not all reaudited here. The old basic-vector comparison becomes 116/147 rather than 108/147. This correction does not resolve its wrong mark ownership or the source errors elsewhere.

## All 13 document measurements

These combine the latest parsable reads across earlier basic v1 and repair v3 revisions. They are not results for one frozen final configuration. Costs include every original call and repair, including the rejected v2 response. Counts/identity inputs overlap. Missing invoice 1 rows require manual handling beyond the inputs counted here.

| Invoice | Originals | Parsed rows | Clear / pending | Count inputs | Identity/source inputs | Cumulative est. USD |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 2 | 0 | 0 / 0 | 0 | 0 | $0.088860 |
| 2 | 1 | 3 | 0 / 3 | 3 | 1 | $0.030984 |
| 3 | 1 | 15 | 9 / 6 | 1 | 5 | $0.062632 |
| 4 | 3 | 31 | 0 / 31 | 31 | 2 | $0.070708 |
| 5 | 2 | 28 | 25 / 3 | 3 | 1 | $0.067672 |
| 6 | 1 | 19 | 18 / 1 | 0 | 1 | $0.055628 |
| 7 | 1 | 23 | 0 / 23 | 23 | 13 | $0.060110 |
| 8 | 2 | 9 | 0 / 9 | 0 | 9 | $0.047524 |
| 9 | 3 | 11 | 6 / 5 | 5 | 2 | $0.065010 |
| 10 | 2 | 24 | 11 / 13 | 3 | 13 | $0.056018 |
| 11 | 2 | 16 | 4 / 12 | 4 | 12 | $0.055030 |
| 12 | 2 | 14 | 0 / 14 | 14 | 1 | $0.054652 |
| 13 | 2 | 16 | 10 / 6 | 1 | 5 | $0.057932 |

Twelve documents have complete parsable reads, 209 rows; invoice 1 has no accepted 29-row read. There are 83 clear proposals and 126 pending rows, all unconfirmed, with 88 count inputs and 65 identity/source inputs (overlapping). No unsupported export succeeds. Invoice4's retained v1 read still selects cases instead of pieces on 31 rows. Invoice3's retained v1 read misses required individual review for actual cross row 13. Invoice1 and4 cannot afford a useful retry under their remaining balances; invoice 3 has exhausted both attempts. Handle those findings manually. Do not silently replace earlier results with a rejected response.

Numeric vector comparisons after the invoice 3 correction:178/209 rows retain the expected printed number;164 have the correct selected quantity, 31 have the wrong selected quantity in invoice 4, and 14 correctly remain unselected because the applicable unit/column is unresolved. These are separate from exact units, keys, barcodes, marks and physical receipt. New 62 accepted repair rows were reopened against originals; other retained baseline assessments are not a fresh independent re-audit. Source containment is not OCR correctness or measured receiver time saving.

## Validation and preservation

229 tests/26 files, build/typecheck, private fixtures and historical detailed replay pass; the existing client bundle warning remains. Historical matching and both detailed transports round-trip 37 invoices/868 rows unchanged. Eight saved basic v1 source parses and matching cores remain unchanged; earlier documented removal of empty inventory scaffolding changes only metadata. Four v3 source parses replay exactly. Product/count matching cores remain unchanged; additive replay adds the nine source-key review flags for invoice 8 and removes duplicate/misleading warnings for invoice 12. The rejected v2 remains rejected.

All 1,931 pre-existing private files are hash-identical and all 24 original-photo hashes match the manifest. Synthetic browser checks showed clear proposed counts, both literal columns, blank doubtful counts, unchecked physical attestation, disabled confirmation and blocked export. No count was entered and no approval was clicked. Temporary preview tab/server are closed. Evidence, frozen requests, prepared bytes, failures, usage, adjudications, audit replays and screenshots are private under `private/testing/basic-sonnet-repair-20261030/`.

## Costs and recommendation

Added repair development: **US$0.267386** for five generation responses, including one strictly rejected response. Previous basic campaign: **US$0.505374**. Combined authorized 13-document campaign: **US$0.772760**, 213,185 input + 34,639 output tokens, including zero thinking tokens. All 14 dispatched calls have known usage; no thinking is double-counted. Every cumulative document stays <=US$0.099 and aggregate <=US$1.287. **These are usage-based estimates, not verified provider billing.** Historical campaign costs remain separate in their preserved reports (the older 13-photo-set campaign was estimated US$1.029594); they are not charged again to this campaign.

Recommended configuration is the implemented strict v3 supervised candidate: Sonnet 5.5 between_tools/low, bounded ink views plus full overviews, padded spend gate and explicit human receiving. **Hold unattended rollout.** Exact source-field completion, handwriting ownership and excessive manual work remain open. The US$0.05–0.08 average target is still unvalidated for a frozen full 13-document request; this mixed development campaign's average is not a future performance guarantee. Do not repeat spent documents or create substitute jobs to pursue a score. Tasks 3–5, push/deployment and operational receiving writes remain out of scope.

Official provider support/rates were rechecked 30 October: [Sonnet 5.5 pricing and no-upfront-thinking](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), [effort compatibility](https://platform.claude.com/docs/en/build-with-claude/effort), [free token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting). Account Models responses and exact request counts are saved per check.
