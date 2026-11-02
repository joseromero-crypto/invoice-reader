## Latest repair checkpoint — 30 October 2026

Implemented and validated locally. See [BASIC-SONNET-REPAIR-RESULTS.md](BASIC-SONNET-REPAIR-RESULTS.md) for all 13 measurements, failures, source-photo corrections, manual work and configuration. All four original budget refusals now have complete reads. 229 tests, build/typecheck, private fixtures and 37-invoice/868-row replay pass; all 1,931 prior private files and 24 original photos are unchanged. Added repair generation estimate $0.267386; cumulative authorized campaign $0.772760, billing unverified. No operational writes or approvals.

Production acceptance still FAILS. Native v3 fixes the malformed-reference layout, but source-field omissions and mark errors remain. All basic receipt confirmations are human. Only invoice 12 freshly used the final prompt; other checks used earlier revisions. Do not call this a frozen full-set success or claim proven receiver savings. The old invoice 3 quantity vector was wrong: initial basic counts were correct; the historical 238/238 claim is withdrawn. Keep all old material below as history.

## Repair build — 30 October 2026

The next implementation and validation steps are written in [BASIC-SONNET-REPAIR-PLAN.md](BASIC-SONNET-REPAIR-PLAN.md). Prior measurements below remain unchanged.

# Basic Sonnet implementation checkpoint — 30 October 2026

Implemented and locally validated; **production acceptance FAIL**. See [BASIC-SONNET-RESULTS.md](BASIC-SONNET-RESULTS.md) for the full per-invoice measurements, configuration, manual-work impact and limits. Private original evidence: `private/testing/basic-sonnet-20261030/REPORT.md`.

- Explicit strict basic contract plus compact native transport; no invented detailed inventories. Exact source fields/refs, short uncertainty/handwriting and original-photo coverage are retained. Clear proposals initially unconfirmed; specific doubts require individual input, blank doubtful counts accept explicit zero, physical bulk review/export guards retained.
- Sonnet5.5 between_tools/low verified with official pricing, account Models API and exact free request checks. $0.099 shared document admission replaces the equal-slot policy; padded input plus actual permitted output reserved before dispatch, failures/unknown spend retained, at most two explicit attempts and one paid call per claim. No automatic escalation/retry or SDK retries.
- All13 second-round documents assessed:8 complete,1 truncated,4 refused before generation.9 paid calls estimated$0.505374,136,622input/23,213output,0thinking; billing unverified. All individual/aggregate limits respected. Mixed evolving settings: final request reproduced exactly on4 completed documents, not a uniform13-document final-config benchmark.
-108/147 returned printed counts correct;39 wrong (eight alignment shifts,31 cases-for-pieces).126/128 scored keys and57/58 scored barcodes exact.91 expected rows have no accepted read. Wrong/missed handwriting, invented units/labels, coverage declarations and excess inputs remain;0AI confirmations/unsupported exports does not make OCR correct.
-52 clear proposals/95 pending, all147 unconfirmed;66 physical-count inputs and52 identity-warning rows (overlap). Receiver seconds/savings unmeasured; additional hidden-error correction and five full-document manual cases add work. No complete in-app manual-entry fallback is claimed.
- Recommendation:keep local candidate undeployed. Source/safety/budget implementation is reviewable; general reliable cheap-reading and receiver-effort acceptance is not met. Tasks3–5 remain queued. No push/deploy, operational DB write, receiving approval, job reset or historical rematch.

---

## Preserved planning/historical checkpoint

# Back to basics: simple Sonnet reading and manual confirmation

Date: 30 October 2026 (America/Monterrey).
Status: USER-REQUESTED PLAN. This workflow is not implemented or benchmarked. This documentation change makes no provider calls, changes no application behavior or budget, and performs no push, deployment or operational receiving write.

## Decision

Use Sonnet for a quick, useful reading of the printed supplier invoice. Preserve the original photo and source values, propose catalog matches locally, and ask the receiver to resolve doubts. Reduce the elaborate AI-generated geometry and duplicate evidence inventories. The goal is a reliable draft that saves entry work, with physical receiving decisions made by the receiver.

This replaces the proposed universal detailed-evidence approach for the NEW basic reading mode. Existing historical extractions and their evidence remain unchanged. Haiku remains rejected for production because of measured unsafe mark interpretation. Detailed Sonnet reading is a historical comparison, not unquestioned ground truth.

The practical outcome should be: most readable rows need a quick human review, a few doubtful rows need specific inputs, and no automatic AI approval can turn a missed or misread mark into a confirmed receipt.

## Keep useful source data; reduce the expensive reporting

| Keep in the basic read | Reduce or remove from the basic AI response |
|---|---|
| Immutable original photos, source hashes, original-photo order and page/row linkage | Coordinates/baselines for every printed row |
| Exact supplier keys and barcodes, including leading zeros | Coordinates and independently repeated transcription of every quantity cell |
| Verbatim printed descriptions, billed quantities and units | Separate full handwriting inventory with positions and geometric ownership proof |
| Supplier/reference/date when readable; concise literal source-row text | Repeated prose, financial reconciliation and unnecessary duplication |
| Brief field-specific doubts and per-row handwriting observations | Attempts to decipher overwritten arithmetic or infer physical received counts |
| A small per-photo row/coverage summary | Long diagnostic narratives or model confidence presented as proof |

The AI still reads the photo as evidence. We are reducing the extra data it generates about its reading. The app's locally generated labels such as exact barcode match, supplier-key match and human confirmation remain useful and inexpensive; hiding those labels does not materially reduce provider tokens.

Keep a concise observation for each row: no mark seen, check-like mark, other handwritten mark, or uncertain inspection. Preserve literal handwritten text when readable without extended interpretation. A check-like label is a reading proposal, not receipt approval. If ownership is unclear, record the plausible nearby source rows and ask about those items separately. Do not fabricate a certain assignment or flag unrelated rows.

## Sonnet request and image preparation

- One paid Sonnet extraction call by default. No separate paid classification pass, automatic second read, fallback model or paid tool loop.
- Start the candidate with Sonnet's supported `between_tools` setting and low effort to avoid up-front thinking. Recheck official compatibility at implementation time. Do not use the unsupported Sonnet `thinking: disabled` setting. This configuration has not been accepted on the simpler full-invoice workflow yet.
- Ask for printed rows and concise uncertainties. Do not ask the model to reason through the physical receipt decision or solve unclear handwriting.
- Retain free local image validation, EXIF/orientation handling, source ownership/hash checks and trusted source-photo mapping. Preserve every full original overview.
- Retain the ability to add bounded detail views where useful. Do not globally remove them: the overview-only experiment omitted a visible Danone row. Measure any reduction in duplicate views against source/mark coverage first.
- Preserve 16,000/32,000 as the maximum output ceilings by original-photo count. The actual request allowance can be lower to fit the spend budget and the smaller response. Truncated output remains a failed read, never a partial invoice accepted as complete.

## A new explicit reading contract

Introduce a versioned basic source-reading contract instead of weakening or impersonating the current full-evidence contract. It should require:

1. Document metadata and an ordered list of source rows with exact printed identifiers, descriptions, billed quantity/unit, original-photo reference and concise literal source text. Unknown values remain null; no catalog-derived source reconstruction.
2. Explicit per-row field uncertainty and a concise handwriting observation, with literal text only when readable. Keep printed counts separate from notes and physical received quantities.
3. A compact per-original-photo coverage declaration, including fiscal/non-item and overlapping photos. Repeated views must not create extra item occurrences; repeated actual items remain separate lines.
4. Strict types, required fields, enum/reference/count checks and rejection of unknown fields, malformed JSON, incomplete responses and invalid source references.

A model's coverage count or no-mark observation does not independently establish that nothing was missed. Keep structural validation and independent photo-ledger tests, and require the receiver to review the photo/list for completeness before accepting the document. A known omitted row is a coverage failure; a reader must not make a partial document look complete.

Do not fill the old annotationEvidence/quantityEvidence arrays with fabricated empty data to pass validation. Do not send a basic read through the legacy missing-evidence fallback unchanged: current row construction can interpret row-level checks as confirmation when the detailed inventory is absent. Parsing, row construction, review and export must understand the new mode explicitly. Full-evidence/legacy parsing and saved histories remain backward compatible.

## Manual receiving behavior

Printed billed quantity is a reference/proposal. Received quantity is a human-confirmed physical count. Preserve both separately, together with original source values and any later human correction/audit.

| Situation | Receiver action |
|---|---|
| Item and printed count are readable, with no reported doubt | Review the proposal and explicitly attest identity/count against physical receipt; eligible rows can use the existing bulk review action |
| Item is useful/reliable, quantity or handwriting is doubtful | Keep the product proposal and billed reference; leave received pieces blank and request the physical count |
| Printed quantity is readable, identity is doubtful | Keep the billed reference; visibly provisional product proposal, catalog search/selection and identity confirmation |
| Both identity and count are doubtful | Resolve the item and physical count separately; retain all source observations |
| A mark could belong to either of two items | Ask separately for the plausible affected items; preserve unrelated useful rows |

For the basic mode, remove AI-only automatic receipt confirmation, including confirmation based solely on a purported clear check. A cheap check/clean label cannot certify no conflicting marks or missed rows. This is an intentional confirmation policy for the simplified mode, not a claim that handwriting recognition has improved. Existing historical confirmations are not reset or rewritten.

Do not put every row into a pending-error state merely because detailed geometry was intentionally omitted. Clear proposals stay usable in the main review list, initially unconfirmed. Doubtful rows remain specifically flagged and excluded until the receiver resolves them. Human review, rather than invented AI certainty, authorizes confirmation/export.

Reuse the named per-item received-pieces workflow: start doubtful received fields empty, accept explicit zero, reject empty/invalid counts, and retain separate identity warnings. The receiver need not decipher or sum a note. Keep existing physical identity/count attestation, audit records, unresolved-row exclusions and explicit partial-export safeguards.

If a read fails or the budget cannot support a complete read, explain the failure and use original-source/manual handling. Do not silently salvage truncated rows or imply that a full in-app manual invoice-entry flow already exists. Any missing control discovered during usability testing must be recorded and resolved before claiming that the manual fallback is complete.

## Proposed cost policy

**Planning target: average US$0.05–0.08 per document. Proposed hard document limit: US$0.099, including failures and any explicitly requested retry. These are targets, not demonstrated costs or a change already applied.** Dense documents may not fit; manual handling is an accepted outcome instead of exceeding the limit.

The current local implementation is still US$0.05 total, partitioned into two US$0.025 attempt slots. It generally refuses the retained full-cap Sonnet requests. A basic Sonnet implementation needs a deliberate policy update; removing the detailed inventories alone does not make that current allocation workable.

For the proposed mode:

- Retain the durable per-document spend ledger. Before dispatch, count the exact request with the free endpoint, reserve padded input plus maximum permitted output at verified rates, and refuse a request that cannot fit the remaining document allowance.
- Derive a useful actual output allowance within the existing 16K/32K ceilings. Do not reserve the full old output ceiling by default when the smaller budget cannot afford it. Do not buy a deliberately inadequate allowance just to fit the number; insufficient budget must lead to manual handling.
- Keep one paid call per existing claim and zero SDK retries. Keep the existing maximum of two explicit attempts, duplicate protection, membership/ownership checks, active lease and claim-token fencing. A second attempt is not guaranteed: it must fit the remaining document budget and use the normal attempt path.
- Replace the equal attempt-slot allocation only as an explicit reviewed policy change. The first complete read may use the available document allowance; known and unknown earlier spend remain counted. Never reset a job, create a substitute job or discard failure charges to obtain more allowance.
- Reconcile actual usage after every response, including failures/truncation, with thinking counted once inside output. Preserve reservations for interrupted/unknown usage and block further spending on unpriceable or unexpected overages. Keep estimated cost separate from verified billing.
- No automatic targeted stronger-model stage in the first basic version. The successful nine-mark crop is a separate experiment, not an implemented workflow. Future stages need durable stage IDs/count limits, reservation before every dispatch and a tested source-preserving merge before they can be enabled.

Current measured full Sonnet reads cost about US$0.11–0.32. Subtracting their thinking tokens while keeping the same input/answer gives a hypothetical US$0.08–0.19, not a measured no-thinking result. The lower target therefore requires a smaller response and careful image input as well as less thinking. There is no promised cost or manual-work saving until the new basic workflow is measured.

## Implementation order

1. Preserve the current code, local edits, original photos, independent expectations, raw attempts and historical records. Re-read the cost report and capacity limitations.
2. Define the basic contract and explicit mode. Add strict parsing/source-reference validation and a tested adapter to matching/review. Do not weaken the old fresh-extraction validator or fabricate missing inventories.
3. Implement the Sonnet request, economical response allowance and proposed document-budget accounting. Keep image changes bounded and independently measurable.
4. Implement the basic-mode human-confirmation policy through row construction, review, individual/bulk confirmation and export. Keep catalog matching local and preserve exact source values.
5. Run focused synthetic regressions, full tests/build/typecheck, private fixtures and unchanged historical replays. Use UI checks for blank doubtful counts, explicit zero, identity selection, bulk physical attestation, partial export and source preservation.
6. Benchmark original photos with independent expectations kept out of prompts. Begin with a readable control such as Danone and difficult LALA; inspect each result before further spending. If usable, extend to Arca pieces-versus-boxes/crosses, Sigma numeric ownership/long pages, Qualtia loops and Bimbo supplier/background separation. Record a bounded development-call/spend plan before dispatch; this documentation dispatches none.
7. Update the handoff with measured cost/latency/quality and receiver workload, then recommend a production configuration only if the data supports it. User handles pushes; no deployment or receiving-record writes are part of this plan.

## Acceptance and honest reporting

- Exact source identifiers/leading zeros, printed counts/units, repeated items, order and all original-photo rows are evaluated independently. A correct catalog match cannot erase a wrong source key; billed counts cannot be replaced by boxes, pack multiplication or handwriting.
- Measure handwriting detection, wrong/missed marks, neighboring-row ownership, confident source mistakes, coverage failures, unsafe confirmations and excess review separately. Human containment does not turn an OCR mistake into a correct read.
- No basic-mode row becomes received/confirmed solely from model output. Unresolved identity/count/ownership doubt cannot pass bulk confirmation or export. Correct clear rows remain useful without individual retyping.
- Measure the number of rows needing identity selection, manual physical-count entry, extra photo inspection and the time/effort required. Do not call a lower pending count an improvement if uncertainty was simply missed.
- Total document cost includes failed calls and any explicit retry. Report distributions for short/dense documents, completion rate, input/output/thinking tokens, local end-to-end latency and estimated versus verified cost. Report development spending separately.
- Verify strict parsing and source preservation, attempt/fencing protections, spend persistence across restart, no double dispatch, zero SDK retries, no unbounded fallback and unchanged historical matching/review records.

Scope remains the reading cost/manual-assistance workflow. Original Tasks 3–5 remain queued except for changes directly necessary to this workflow. No redesign, historical rematch, operational write, blanket approval or false claim of a proven sub-ten-cent reader.

## Reference checkpoints

- `docs/INVOICE-COST-CONTROL.md`: implemented budget policy, failed Haiku benchmark, useful crop and complete development accounting.
- `docs/OUTPUT-CAPACITY-REPAIR.md`: working detailed Sonnet baseline, retained ceilings and known quality limitations.
- `HANDOFF.md` and `OCT-29-FIXES.md`: latest direction above preserved historical notes.
- Private original photos/independent expectations and `private/testing/cost-reduction-20261030/`: authoritative historical evidence; never provider prompt answers.
