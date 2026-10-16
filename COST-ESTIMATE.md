# AWS Cost Model (Planning Estimate)

**Region:** Asia Pacific (Mumbai), `ap-south-1`  
**Budget cap:** ₹12,500/month  
**Status:** planning estimate, not a verified AWS quote. AWS calculator export `docs/billing/aws-calculator-corrected-2026-10-16.pdf` still includes EC2 and does not show Lambda render duration/memory; DynamoDB read/write request quantities are also not visible in the export.

## Selected design

- Lambda/Puppeteer renderers: standard tier at a provisional 2 GB; large-document tier at a provisional 6 GB.
- 15 provisioned-concurrency slots for the standard single path during an assumed 8-hour business window, 22 days/month (176 hours).
- If peak timing is predictable, increase the single path from 15 to 42 provisioned slots for an additional 15 minutes per business day (27 additional slots × 5.5 hours/month).
- Total concurrency target: 45 single + 40 bulk standard + 15 large = 100 render slots, subject to account quota and load testing.
- 30,000 PDFs/month, provisionally split into 27,000 standard and 3,000 large PDFs. The 10% large share and 2.5-second duration are assumptions, not measured data.
- S3 estimate retains 360 GB/month from the corrected calculator export as a conservative placeholder. An additional $5/month egress allowance is included because the export does not show customer download transfer.

## Line-by-line estimate

| Service / cost | Basis | USD/month |
|---|---|---:|
| S3 | Corrected export: 360 GB and request assumptions | 9.46 |
| SQS | Corrected export: 0.15 million requests | 0.06 |
| CloudWatch | Corrected export | 1.08 |
| DynamoDB | Corrected export, Standard class, 1 GB; read/write quantities still need explicit confirmation | 2.48 |
| API Gateway | Corrected export | 0.06 |
| KMS | Corrected export: one customer-managed key and 30,000 asymmetric requests | 1.45 |
| Lambda execution allowance | 27,000 × 2.5 s × 2 GB = 135,000 GB-s; 3,000 × 2.5 s × 6 GB = 45,000 GB-s; 180,000 GB-s × illustrative $0.0000166667 = $3.00 before free-tier benefits | 3.00 |
| Provisioned concurrency baseline | 15 × 2 GB × 176 h × 3,600 s × illustrative $0.0000041667/GB-s | 79.20 |
| Scheduled peak increment | 27 × 2 GB × 5.5 h × 3,600 s × illustrative $0.0000041667/GB-s | 4.95 |
| Egress allowance | Placeholder only; replace with calculator result from actual download traffic | 5.00 |
| **Total** | Before taxes and regional-rate corrections | **106.74** |

At an illustrative ₹95/USD, $106.74 is approximately **₹10,140/month**, leaving approximately **₹2,360/month** under the ₹12,500 cap. The conversion is for planning only. The provisioned-concurrency rates are taken from the public AWS Lambda pricing page's example and must be checked against Mumbai-specific calculator rates. Do not treat Free Tier discounts as guaranteed.

## What was removed from the supplied export?

The corrected export totals $50.03/month, including EC2 `t3.medium` at $35.44/month and Lambda at $0.00. EC2 is removed because it is not in the selected Lambda-based architecture. Remaining listed services total:

`$50.03 − $35.44 = $14.59/month`

This $14.59 subtotal includes S3, SQS, CloudWatch, DynamoDB, API Gateway and KMS. It is not the final cost on its own.

## Provisioned-concurrency and latency constraint

The chosen estimate keeps 15 warm standard-render slots for the assumed business window and schedules 42 slots only during a predictable short peak. If 42 warm slots were required for the full 176-hour business window, the illustrative capacity charge alone would be:

`42 × 2 GB × 176 h × 3,600 s × $0.0000041667 ≈ $221.76/month`

That exceeds the entire budget before other services. Therefore, the full peak and a strict sub-five-second completed-PDF SLA cannot be promised from the current assumptions. Peak duration and predictability must be clarified and the design load-tested. If the service is at capacity, returning `202 Accepted` with a job ID preserves responsiveness and reliability but does not satisfy a requirement that the PDF itself start downloading within five seconds.

## Storage cross-check

At 500 KB per PDF, 30,000 PDFs produce approximately 15 GB of new PDF artifacts/month. With 12-month retention, that is approximately 180 GB at steady state before input snapshots, ZIP parts, manifests, object versions and compliance copies. The calculator's 360 GB assumption is retained for now to avoid underestimating; replace it after measuring real artifact sizes and confirming retention.

## Final calculator actions required

1. Remove EC2 from the estimate.
2. Add Lambda duration and memory separately for standard and large tiers.
3. Enter provisioned concurrency hours and the short-peak schedule.
4. Enter explicit DynamoDB on-demand read/write request counts (the exported summary does not show them).
5. Verify S3 storage/requests, Object Lock/versioning effects and customer download egress.
6. Verify SQS retries/DLQ, KMS key type/signing operations, CloudWatch log ingestion and current Mumbai rates.
7. Export the revised estimate. Only then replace this planning estimate with a verified calculator total.

## Pricing references

- AWS Lambda pricing: https://aws.amazon.com/lambda/pricing/
- Lambda quotas: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
- Lambda concurrency scaling: https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html
