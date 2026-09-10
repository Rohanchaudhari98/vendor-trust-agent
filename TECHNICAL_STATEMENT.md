# Technical Statement

## The problem

I was building an AP (accounts payable) invoice automation workflow for a retail client — extraction, PO matching, approval routing, gated on an extraction-confidence threshold before an invoice moves toward payment. Partway through, someone on the client's finance team asked a question that stuck with me: "this all assumes the invoice is well-formed — what confirms the *vendor* is real?" Extraction confidence tells you the OCR read the document correctly; it tells you nothing about whether the vendor issuing it is who they claim to be. That gap is where vendor-impersonation and shell-company fraud lives, and it's bigger and faster-growing than the "rare edge case" framing usually suggests — 45% of organizations reported vendor imposter fraud in 2024 (AFP), and billing/shell-company schemes carry a $100K median loss per case (ACFE). That question became this project: a lightweight, Tavily-powered pre-payment vendor check designed to slot into that exact workflow gap.

## What was wrong with the naive approach

The straightforward way to build this — the pattern embodied in the starter script this take-home provides — is a freeform LangChain agent that calls a search tool whenever it decides to, then reasons over whatever raw JSON comes back. Three things break down for a financial-risk use case specifically: (1) a ReAct-style agent picks its own retrieval strategy per run, so two runs on the same vendor can search different things and produce non-comparable outputs — hard to evaluate, hard to trust. (2) Raw search JSON piped straight to the model means it's reasoning over snippets, not real page content — the one sentence confirming or denying a registration often isn't in the snippet. (3) No cited, structured output — an unstructured chat reply isn't something an AP clerk can act on or an auditor can trace back to a source.

## Design choices and why they matter

**Deterministic pipeline over a ReAct loop.** Three fixed, parallel Tavily searches (legitimacy, adverse media, entity consistency) → score-filter and dedupe → targeted `extract()` on only the shortlisted URLs → one bounded LLM call. Same steps every time, which is what makes an eval harness meaningful at all.

**Search then Extract, not just Search.** Filtering by Tavily's relevance `score` and deduping by domain before extraction means the model reads real page text on a handful of the best sources, not snippets from all of them.

**A named fraud taxonomy, not a generic risk score.** `vendor_impersonation` / `invoice_fraud` / `shell_company` map to real ACFE/AFP categories. `needs_manual_review` is a first-class tier — a thin web footprint is honestly ambiguous (small legit vendors have one too), and forcing a confident score out of thin evidence would be worse than admitting uncertainty.

**Every claim cited, hedged language enforced, evidence treated as untrusted data.** The system prompt requires a `Citation` on every finding, bans unqualified accusations, and explicitly tells the model to treat retrieved web content as data to analyze — not instructions to follow — since a scam vendor's own site is part of the evidence being read.

## Business outcome

An AP clerk gets a cited, few-cents-per-check research pass in under a minute on every new or unfamiliar vendor — not just the ones that happen to already look suspicious. In the 8-fixture eval included here, the pipeline correctly cleared 2 well-known legitimate vendors and correctly held 6 thin/ambiguous vendors for manual review, all traceable back to real sources, at roughly $0.08/check.

## Next steps for a real customer

Wire this into the AP exception queue as an automatic check on any vendor without prior payment history; add a human-override feedback loop so corrections tune thresholds over time; and cross-reference the client's actual vendor master for true typosquat/impersonation detection, which open web search alone can't do.
