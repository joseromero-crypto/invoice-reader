## Latest repair checkpoint — 30 October 2026

Implemented and validated locally. See [BASIC-SONNET-REPAIR-RESULTS.md](BASIC-SONNET-REPAIR-RESULTS.md) for all 13 measurements, failures, source-photo corrections, manual work and configuration. All four original budget refusals now have complete reads. 229 tests, build/typecheck, private fixtures and 37-invoice/868-row replay pass; all 1,931 prior private files and 24 original photos are unchanged. Added repair generation estimate $0.267386; cumulative authorized campaign $0.772760, billing unverified. No operational writes or approvals.

Production acceptance still FAILS. Native v3 fixes the malformed-reference layout, but source-field omissions and mark errors remain. All basic receipt confirmations are human. Only invoice 12 freshly used the final prompt; other checks used earlier revisions. Do not call this a frozen full-set success or claim proven receiver savings. The old invoice 3 quantity vector was wrong: initial basic counts were correct; the historical 238/238 claim is withdrawn. Keep all old material below as history.

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

> Latest direction, 30 October 2026: the user requested the plan in [SIMPLE-SONNET-READING-PLAN.md](SIMPLE-SONNET-READING-PLAN.md): a simpler Sonnet source read with fewer generated evidence inventories and human confirmation for doubts. That mode and its proposed US$0.099 document limit are not implemented or benchmarked. The implemented US$0.05 policy and measured cost/quality results below remain unchanged historical evidence.

# Invoice cost control — 30 October 2026

Local implementation; no push, deployment or operational receiving write. Read this alongside `OUTPUT-CAPACITY-REPAIR.md`. A low price is not extraction acceptance. The selected Sonnet baseline also has unresolved source/handwriting errors.

## Implemented spend policy

`server/invoice-spend.ts` admits only verified model pricing and standard on-demand requests. Official model/pricing/capability pages and the account Models API were checked on 30 October. Haiku 5.5 supports images, native structured output and adaptive effort; the account supports disabled thinking but not between_tools. Sonnet's between_tools option remains diagnostic only.

Standard global rates per million tokens: Haiku input/output $0.10/$0.50 through 100,000 prompt tokens, $0.50/$2.50 above that threshold; Sonnet $2/$10. The entire request is priced at the applicable tier. Old optional environment price estimates do not override these verified rates. Unknown model pricing fails closed. No cache, tools, batch, fast or priority billing is enabled.

Each document has a $0.05 estimated-spend limit. Existing two-attempt claiming remains intact; each attempt has a non-transferable $0.025 allowance and at most ONE paid extraction call. Token counting is a free API preflight, not a paid classification pass. It counts the actual system, messages/images and output schema. Admission reserves 120% of counted input plus 1,024 tokens and the FULL permitted output, including thinking. A threshold-crossing reservation uses the higher Haiku tier. The 16,000/32,000 maximum output ceilings remain unchanged. Requests exceeding their slot are refused before dispatch; the original Sonnet requests generally cannot fit.

Reservations are persisted in `extraction_jobs.usage.documentSpend` BEFORE dispatch, filtered by organization/job/status/claim token/active lease. Membership is checked again before calling. The locked claim's history is authoritative. A crash/interruption retains the reservation; it is not treated as free. Completed, truncated and invalid responses retain actual usage/cost, with thinking counted once inside output_tokens. Per-call history survives retries; estimated_cost_usd is the document total, including reserved unknown spend. Provider overages fail closed and block further overspending. Historical attempts without bounded spend history cannot receive a new paid read through this policy. No job reset or substitute document is created.

The money limit is an admission policy based on current published rates and a padded token estimate, not verified billing or a provider-side spending guarantee. Unexpected provider counting/pricing changes can still exceed an estimate; reconciliation detects this. No production billing dashboard or invoice was available for verification.

## Staged-call accounting

There is no automatic escalation, classification call, paid crop tool loop or fallback model call. A claim still reserves one existing attempt/counter increment, and its sole call is uniquely recorded by attempt number. A second call under the same attempt is rejected. Two separate attempts cannot exceed the document reservation limit. Interrupted calls keep their reservation across process restarts.

A future staged reader must first extend the durable ledger to uniquely identify each stage, reserve the whole next request under the same claim/lease before dispatch, include failed and unknown stages, enforce a separate finite stage count, and preserve source/coverage/ownership through a tested evidence merge. That work is NOT enabled here. A cheap-reader confidence/clean label is never an independent no-missed-mark guarantee. Existing specific per-item identity/received-piece review remains active for valid uncertain extractions. Rejected outputs are not salvaged into receiving rows.

## Reader changes and experiments

The free local image diagnosis, upright full-original overviews, at most two traceable detail views per original, trusted coordinate transforms and request-size guard are retained. An overview-only experiment missed a visible source row even though its self-reported coverage passed. Do not enable that ablation.

Haiku first received the unchanged complete extraction/evidence request, with the same original/prepared photos and strict parser. Adaptive medium and low exhausted the small output ceiling. Disabled thinking returned incomplete/incorrect evidence and shifted quantities. These are measured failures, not a demonstrated one-cent reader. No handwriting feature was removed to force acceptance.

The subsequent Haiku candidate uses concise source/handwriting instructions, low adaptive effort, and a small mixed transport: existing compact v7 string tables plus named mark/coverage records. Native decoding constrains mark kinds and original overview references; local conversion changes syntax only. It never normalizes invalid kinds, fills source values, fabricates inventories, clamps geometry or repairs coverage. The original strict full domain validator and unchanged matching/receiving/export guards run afterward. A fully named schema was rejected for grammar complexity; its failed request remains in private evidence. The mixed schema is accepted by the provider. Sonnet's existing source/evidence request remains unchanged apart from standard billing selection and the spend gate.

## Validation and production recommendation

The measured benchmark rejects Haiku for production. `extractJob` blocks Haiku before claiming or spending; its request/image/transport support remains available only for local diagnostic work. The budget guard is implemented, but a general useful and safe production reader below $0.05/$0.10 has NOT been established. With the retained full output ceilings, the current Sonnet requests are refused by the new budget gate. Do not deploy this candidate as a production reader replacement. The existing live deployment was not changed. Detailed outcomes are recorded at the top of HANDOFF.md and in the private cost report. Do not interpret a completed response or self-reported coverage as full OCR/handwriting acceptance. Source identifiers, printed quantities, coverage, mark meaning/ownership, unsafe confirmations, excess manual review, latency and total failed-call cost are separate measures. Original-photo expectations and catalogs never enter extraction prompts. Catalog matching is local and occurs only after strict extraction validation.

The final 198-test checkpoint, build/typecheck/private fixtures and both transports' lossless round trips across 37 invoices/868 rows pass. Saved matching replays are identical and all 1,428 pre-existing private files remain hash-identical. Legacy observation scaffolding is only in-memory codec QA, not new photo evidence. Tasks 3–5 remain out of scope. Hosted upload/persistence and production billing have not been exercised.

## Official references

- [Haiku 5.5 capabilities and tiered pricing](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
- [Models API and availability](https://platform.claude.com/docs/en/models/overview)
- [Effort and thinking compatibility](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Vision resolution and patch limits](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Free token counting and estimation limits](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [Structured outputs and grammar limits](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

## Measured outcomes

The unchanged full-contract Haiku LALA check consumed all 16K tokens in thinking and returned no answer ($0.01083). Low effort also truncated. Disabled thinking finished cheaply but omitted evidence and shifted quantities; it is rejected. Compact prompts reduced input, but completion and evidence failures persisted. No failed answer was normalized or repaired into an accepted invoice.

| Local experiment | Outcome | Estimated USD | Count-to-result latency |
|---|---|---:|---:|
| Mixed-record Danone | 16/16 exact source keys/counts, both photos covered; 0 pending, no known unsafe confirmations | $0.00742 | 46.85s |
| Mixed-record Sigma12 | 58/58 exact keys/counts in rejected output; invalid coverage inspection and omitted checks; 0 accepted rows | $0.01156 | 63.36s |
| Final mixed-record LALA | All 16K output tokens consumed by thinking; 0 accepted rows | $0.01050 | 72.25s |
| Final mixed-record Arca | 30/31 rows, boxes read instead of printed pieces on all 30 returned items; invalid page-number cell; rejected | $0.01121 | 72.79s |
| Final mixed-record Qualtia | 23/23 counts and 4/4 independently certified keys; unresolved loops called checks, 21 unsafe in-memory confirmations | $0.00804 | 48.62s |
| Overview-only Danone ablation | 15/16 rows; self-reported coverage passed despite omitted source row; rejected for quality | $0.00554 | 34.62s |
| Sonnet targeted crop | Nine visible marks correctly unresolved; diagnostic only, no merge | $0.00875 | 4.68s generation only |

These are different development settings, not a final seven-document production campaign. Bimbo and Sigma19 were not run with this candidate after the unsafe Qualtia result. Danone's successful mixed-record request predates the final coverage-enum tightening; exact requests/source checkpoints remain private. Its response is still valid under the tightened contract, but it was not freshly rerun. We do not claim all successful measurements match the final request byte-for-byte. Early native smoke summaries retained a hardcoded transportVersion=7; actual schema/version/request and raw responses are authoritative. The diagnostic now records the actual schema version.

On the single successful Danone sample, input fell from 24,744 to 21,330 tokens (13.8%); total input+output fell from 33,910 to 31,900 (5.9%). Output rose from 9,166 to 10,570 tokens. Estimated cost fell from $0.14115 to $0.00742 (94.7%), predominantly because of model pricing. Its previously misread supplier key/barcode now agree with the independent original-photo review. This is useful measured extraction, not general acceptance or a randomized quality comparison.

Manual-review impact is mixed: Danone's pending count fell 1→0, but Qualtia's 23→2 pending drop is a SAFETY REGRESSION, not an automation gain. All 23 Qualtia marks require unresolved interpretation in the independent review; 21 were auto-confirmed only in memory by unchanged matching/receiving logic. Failed reads create no usable rows and require original-source review. Sigma omitted reported clear checks; excess manual work cannot be certified from rejected output. There is no demonstrated reduction in overall manual workload.

The targeted Sonnet experiment used one bounded crop with neighboring rows plus a small full overview for provenance. No independent expectations, catalog answers or expected source identifiers entered the request. It returned all nine visible marks as unresolved, containing seven of the initial 21 unsafe confirmations only in a hypothetical review of that crop; the rest of the invoice was not audited by this call. Initial+target estimated actual cost was $0.01679; the reconciled initial cost plus the next call's maximum reservation was $0.02504, below the document limit. This is NOT an implemented production stage or approved merge. A useful crop result does not certify unseen marks, exact identities, other invoices or full-document coverage.

All development checks: 15 dispatched generation requests, 14 responses with known usage totaling 309,088 input / 169,308 output tokens, including 109,193 thinking tokens already counted in output. Estimated known-usage cost is $0.1238753. One HTTP 400 schema-complexity rejection has no returned usage; it is not silently assumed free. Retaining its full $0.0107976 reservation gives a conservative accounted total of $0.1346729. These totals include failures and the stronger crop, exclude historical campaigns, and are NOT verified billing. Free token-count/Models API requests are separate from paid extraction. No further paid calls are scheduled.
