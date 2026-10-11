# Credora receipt verification agents

Excerpt from Credora, a loan management system I designed and built for a lender running daily field collections. It shows two agents that run on their own and know when not to guess.

## The pipeline

A borrower sends a receipt photo over WhatsApp (via a self-hosted n8n bridge). The receipt agent extracts the payment details, and an independent bank-email agent cross-checks the payment before it posts to the ledger.

1. `src/receipts/ocr.service.ts` runs a Tesseract.js OCR pass on the image, normalised with sharp. If confidence comes back LOW (blurry or handwritten slips), it escalates to a vision LLM through OpenRouter and returns structured JSON: amount, UTR, payer UPI id, plus a confidence score.
2. `src/bank-email/bank-email-parser.service.ts` parses the bank's credit-alert emails. It only treats credits as payment evidence; a debit alert can never verify a receipt.
3. `src/bank-email/bank-email-matching.service.ts` matches the parsed email against pending receipts: exact UTR match first (unique by a DB constraint), then an amount plus time-window match only when exactly one pending receipt qualifies. Two borrowers paying the same amount in the same window is a collision, so neither gets auto-verified; both go to admin review.

## Design decisions I would defend in an interview

- Cheap model first, stronger model only on failure. Tesseract is free and fast; the vision LLM is only billed for the receipts it actually needs.
- Refusal to guess is a feature. Ambiguous extractions and ambiguous matches are surfaced to staff, not resolved by probability.
- Every verified payment lands in an append-only double-entry ledger with an HMAC hash chain (not in this excerpt), so postings are auditable and tamper-evident.
- Receipt text and payer identifiers are encrypted at rest.

## Stack

TypeScript, NestJS, PostgreSQL (Prisma), Tesseract.js, OpenRouter (vision model), self-hosted n8n, Razorpay Smart Collect.

Copyright (c) 2026 Krishna Prasadh. All rights reserved.
