# Approach Document

## 1. Initial Understanding

The ERP needs a separate service to generate invoice and purchase-order PDFs, individually or in batches of up to 100. It must handle peak traffic, large documents, progress tracking, reliable downloads, consistent batch data, and tamper evidence without exceeding the ₹12,500 monthly budget.

My initial approach is to isolate PDF rendering from Django, queue bulk work, store files outside the API, and limit concurrent renders. Traffic, memory use, data consistency, and AWS costs must be tested before promising the required latency or budget.

## 2. Assumptions & Clarifying Questions

### Assumptions

- Region: AWS Asia Pacific (Mumbai), `ap-south-1`; monthly budget: ₹12,500.
- Django/PostgreSQL remain the source of truth. Django sends resolved document data, not mutable IDs alone, from an agreed consistent-read boundary.
- Large payloads are uploaded to private S3 through short-lived presigned URLs. SQS messages contain IDs and S3 keys, not full payloads.
- One SQS message is created per document. DynamoDB stores job/document status, retries and artifact references.
- Standard renders provisionally use 2 GB Lambda memory; large renders use 6 GB. The 2.5-second render time and 400 MB memory figure come from the assignment and are not measured.
- PDFs and integrity records are retained for 12 months; snapshots and ZIPs for 30 days, subject to compliance approval.
- The corrected calculator export is not the final design estimate: it still includes EC2 and shows Lambda at $0 without render duration/memory. The $106.74/month model below is provisional, not a verified quote.

### Clarifying Questions

1. Is 1,000 single requests/minute a short burst or sustained traffic?
2. Do full 100-document bulk batches overlap with the single-request peak?
3. Is `202 Accepted` plus polling acceptable when a PDF cannot be delivered within five seconds?
4. Can Django provide a consistent, fully resolved snapshot for each batch?
5. What defines a large document, and can it be chunked without changing legal layout or totals?
6. What retention/Object Lock mode is required?
7. What Lambda concurrency quota is available in the AWS account?
8. Does the budget include tax, downloads, provisioned concurrency and compliance retention?

## 3. Capacity Planning & Math

Using the assignment's 2.5-second render time:

- Singles: `1,000 / 60 = 16.67 renders/second`, requiring about `16.67 × 2.5 = 42` concurrent renders.
- Bulk: `5–10 batches/minute × up to 100 PDFs = 500–1,000 PDFs/minute`.
- Combined peak: up to `2,000 PDFs/minute = 33.33 renders/second`, or about `33.33 × 2.5 = 84` concurrent renders.
- A target of 100 total render slots gives theoretical headroom only. Quotas, cold starts, duration and load testing must be verified.
- Monthly volume: `30,000 × 2.5 seconds = 20.83 serial render-hours`.
- At an assumed 500 KB/PDF, output adds about 15 GB/month. Twelve-month PDF retention is about 180 GB before snapshots, ZIPs, manifests and versions.

SQS absorbs bursts but does not create extra throughput. If incoming traffic exceeds completed renders, queue delay grows and the five-second target cannot be guaranteed.

## 4. Design Decisions

### Architecture

Django ERP → API Gateway/Lambda API → private S3 input snapshot → SQS → Lambda/Puppeteer workers → S3 PDFs/ZIPs. DynamoDB tracks job progress; KMS signs integrity digests; CloudWatch monitors failures and queue age.

### Key decisions

- **Separate render lanes:** reserve capacity for single PDFs so bulk jobs cannot starve them. Use a 2 GB standard tier and 6 GB large-document tier; route by measured payload/row thresholds and retry OOM failures in the larger tier with bounded retries.
- **Asynchronous bulk jobs:** enqueue one message per PDF. Return job ID and progress; return `202 Accepted` when a single request cannot safely complete within the response budget.
- **S3 staging and output:** use short-lived presigned URLs and private buckets. Store frozen input snapshots before rendering. Create ZIP parts no larger than 25 MB with a manifest; retry downloads or rebuild ZIPs from stored PDFs without rerendering.
- **Consistent batch data:** Django sends resolved data from one agreed read boundary. Workers render only the frozen snapshot and include a “Data as of” timestamp.
- **Durable and idempotent status:** DynamoDB tracks each document. Retries use stable IDs/output keys. A DLQ reconciliation process marks exhausted documents failed so jobs do not remain stuck.
- **Tamper evidence:** compute SHA-256, sign the digest using an asymmetric AWS KMS key, and protect integrity records and artifacts. S3 Object Lock settings require compliance approval. This is tamper evidence, not a legal e-signature.
- **Monitoring and security:** CloudWatch alarms on errors, throttles, queue age and DLQ depth. Use least-privilege IAM, tenant-scoped authorization, private S3 buckets and short-lived URLs. Never log full invoice payloads.

### Capacity and latency trade-off

The planning model assumes 15 warm standard-render slots for 176 business hours/month, plus 42 slots during a predictable short peak window. Fifteen warm slots do not guarantee a completed PDF within five seconds at 1,000 singles/minute. Keeping 42 warm 2 GB slots for all 176 hours would cost roughly $221.76/month for provisioned capacity alone at the illustrative rate, before other services. The strict peak SLA and budget cannot both be claimed without clarifying peak duration, verifying regional prices and load-testing.

## 5. AI Usage Log

AI assistance was used to compare architecture options, check capacity calculations, identify consistency/retry/download/integrity risks, and review the AWS estimate. The attached billing exports are calculator estimates, not actual invoices.

Previously supplied conversation link: https://chatgpt.com/share/6ad1f180-cb9c-83ec-afc4-b77ba57c2e3a

Add a public share link for the current design discussion before submission and test it in a logged-out/incognito browser. Edit Section 1 so it accurately reflects your own initial understanding.

## 6. Weaknesses & Future Improvements

The main unknowns are real render duration and memory, Lambda quota/cold starts, provisioned-concurrency pricing, large-document thresholds, download traffic and Object Lock requirements. Next steps: benchmark representative small and 500+ row documents, test mixed peak traffic and retries, verify quotas, and rebuild the calculator estimate using measured usage.

## 7. One Thing the Problem Statement Didn't Mention

A job must always reach a terminal state. If retries exhaust and a message reaches the DLQ, reconciliation must mark the document failed and update the batch summary. Also, job IDs and S3 keys are not authorization: every status and download request must be tenant-authorized.

## 8. Cost Estimation

### Basis

The corrected AWS calculator export shows **$50.03/month, $0 upfront**, but includes EC2 `t3.medium` at $35.44/month and Lambda at $0 with no render duration/memory shown. Removing EC2 leaves $14.59/month in the listed services. DynamoDB is $2.48/month, but its request counts still need confirmation.

### Provisional monthly estimate

| Component                                        |  Monthly estimate |
| ------------------------------------------------ | ----------------: |
| S3 (360 GB and requests, as currently entered)   |             $9.46 |
| SQS                                              |             $0.06 |
| CloudWatch                                       |             $1.08 |
| DynamoDB                                         |             $2.48 |
| API Gateway                                      |             $0.06 |
| KMS                                              |             $1.45 |
| Lambda on-demand rendering allowance             |             $3.00 |
| Provisioned concurrency: 15 × 2 GB for 176 hours |            $79.20 |
| Additional 27 warm slots for 5.5 peak hours      |             $4.95 |
| Download egress placeholder                      |             $5.00 |
| **Planning total**                               | **$106.74/month** |

At an illustrative ₹95/USD, this is about **₹10,140/month**, leaving about **₹2,360** against the ₹12,500 cap. This is a planning model, not a verified AWS quote; regional rates, taxes, DynamoDB requests, storage and download traffic must be checked. Do not rely on Free Tier savings in the base estimate.

References: https://aws.amazon.com/lambda/pricing/ and https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
