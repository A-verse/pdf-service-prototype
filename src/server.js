import express from "express";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import archiver from "archiver";
import { renderPdf, closePdfBrowser } from "./pdf.js";
import { positiveIntegerEnv } from "./config.js";
import { validateDocument } from "./validation.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.resolve(process.env.OUTPUT_DIR || path.join(root, "../output"));
const pdfDir = path.join(outputRoot, "pdfs");
const tempRoot = path.join(outputRoot, "temp");
const zipDir = path.join(outputRoot, "zips");
const port = positiveIntegerEnv("PORT", 3000);
const queueName = "pdf-bulk-jobs";
const workerConcurrency = positiveIntegerEnv("BULK_WORKERS", 2);
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

await Promise.all([
  fs.mkdir(pdfDir, { recursive: true }),
  fs.mkdir(tempRoot, { recursive: true }),
  fs.mkdir(zipDir, { recursive: true })
]);

const app = express();
app.use(express.json({ limit: "2mb", strict: true }));
app.use(express.static(path.join(root, "../public")));

const redisConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(queueName, { connection: redisConnection });

app.get("/health", async (_req, res) => {
  try {
    await redisConnection.ping();
    res.json({ status: "ok", queue: "ready" });
  } catch {
    res.status(503).json({ status: "degraded", queue: "unavailable" });
  }
});

app.post("/v1/documents", async (req, res) => {
  const error = validateDocument(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const pdf = await renderPdf(req.body);
    const label = String(req.body.number || req.body.id || "document")
      .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50) || "document";
    const savedName = `${label}-${randomUUID()}.pdf`;
    await fs.writeFile(path.join(pdfDir, savedName), pdf, { flag: "wx" });
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="document.pdf"',
      "Content-Length": String(pdf.length),
      "X-Content-SHA256": createHash("sha256").update(pdf).digest("hex")
    });
    return res.send(pdf);
  } catch (error) {
    console.error("PDF render failed:", error);
    return res.status(500).json({ error: "PDF generation failed. Please retry." });
  }
});

app.post("/v1/bulk-jobs", async (req, res) => {
  const docs = req.body?.documents;
  if (!Array.isArray(docs) || docs.length < 1 || docs.length > 100) {
    return res.status(400).json({ error: "documents must contain between 1 and 100 items" });
  }

  for (const [index, doc] of docs.entries()) {
    const error = validateDocument(doc);
    if (error) return res.status(400).json({ error: `documents[${index}]: ${error}` });
  }

  const id = randomUUID();
  const snapshot = structuredClone(docs);
  try {
    await queue.add("generate-bulk-pdfs", { jobId: id, snapshot }, {
      jobId: id,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 1000 }
    });
    return res.status(202).json({ jobId: id, statusUrl: `/v1/bulk-jobs/${id}` });
  } catch (error) {
    console.error("Could not enqueue bulk job:", error);
    return res.status(503).json({ error: "Bulk queue is unavailable. Please retry shortly." });
  }
});

app.get("/v1/bulk-jobs/:id", async (req, res) => {
  try {
    const job = await queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found or expired" });

    const state = await job.getState();
    const progress = typeof job.progress === "object" && job.progress !== null ? job.progress : {};
    const result = job.returnvalue || {};
    const status = state === "waiting" || state === "delayed" || state === "waiting-children"
      ? "queued"
      : state === "active" ? "processing"
      : state === "completed" ? (result.status || "completed")
      : state === "failed" ? "failed"
      : state;

    return res.json({
      jobId: job.id,
      status,
      total: progress.total ?? job.data.snapshot.length,
      completed: progress.completed ?? 0,
      failed: progress.failed ?? 0,
      errors: progress.errors ?? result.errors ?? [],
      downloadUrl: result.artifact ? `/v1/artifacts/${result.artifact}` : null
    });
  } catch (error) {
    console.error("Could not read bulk job:", error);
    return res.status(503).json({ error: "Job queue is temporarily unavailable" });
  }
});

app.get("/v1/artifacts/:name", async (req, res) => {
  if (!/^[a-f0-9-]+\.zip$/i.test(req.params.name)) {
    return res.status(400).json({ error: "Invalid artifact id" });
  }
  const file = path.join(zipDir, req.params.name);
  try {
    await fs.access(file);
    return res.download(file, req.params.name, error => {
      if (error && !res.headersSent) res.status(500).json({ error: "Artifact download failed" });
    });
  } catch {
    return res.status(404).json({ error: "Artifact not found" });
  }
});

async function createZip(sourceDir, zipPath) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath, { flags: "wx" });
    const archive = archiver("zip", { zlib: { level: 6 } });
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    output.once("close", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    output.once("error", fail);
    archive.once("error", fail);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    Promise.resolve(archive.finalize()).catch(fail);
  });
}

async function processBulk(queueJob) {
  const { jobId, snapshot } = queueJob.data;
  const tempDir = path.join(tempRoot, jobId);
  const zipName = `${jobId}.zip`;
  const zipPath = path.join(zipDir, zipName);
  const errors = [];
  const manifest = [];
  let completed = 0;
  let failed = 0;
  let next = 0;

  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  await fs.mkdir(tempDir, { recursive: true });
  await queueJob.updateProgress({ total: snapshot.length, completed, failed, errors });

  async function renderWorker() {
    while (true) {
      const index = next++;
      if (index >= snapshot.length) return;
      const doc = snapshot[index];
      const safeNumber = String(doc.number || doc.id || `document-${index + 1}`)
        .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50) || `document-${index + 1}`;
      const filename = `${String(index + 1).padStart(3, "0")}-${safeNumber}.pdf`;

      try {
        const pdf = await renderPdf(doc);
        const sha256 = createHash("sha256").update(pdf).digest("hex");
        await fs.writeFile(path.join(tempDir, filename), pdf, { flag: "wx" });
        manifest.push({ index, filename, sha256, bytes: pdf.length, status: "success" });
      } catch (error) {
        failed++;
        errors.push({ index, message: "PDF generation failed" });
        manifest.push({ index, filename, status: "failed" });
        console.error(`Bulk item ${index} failed:`, error);
      } finally {
        completed++;
        await queueJob.updateProgress({ total: snapshot.length, completed, failed, errors });
      }
    }
  }

  try {
    const concurrency = Math.min(workerConcurrency, snapshot.length);
    await Promise.all(Array.from({ length: concurrency }, renderWorker));
    manifest.sort((a, b) => a.index - b.index);
    await fs.writeFile(path.join(tempDir, "manifest.json"), JSON.stringify({
      jobId,
      createdAt: new Date().toISOString(),
      documents: manifest.map(({ index, ...entry }) => entry)
    }, null, 2));
    await createZip(tempDir, zipPath);
    return {
      status: failed ? "completed_with_errors" : "completed",
      artifact: zipName,
      errors
    };
  } catch (error) {
    await fs.rm(zipPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
      .catch(error => console.error("Temporary-file cleanup failed:", error));
  }
}

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") return res.status(413).json({ error: "Request body exceeds the 2 MB limit" });
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ error: "Request body must be valid JSON" });
  console.error("Unhandled request error:", error);
  return res.status(500).json({ error: "Internal server error" });
});

const workerConnection = redisConnection.duplicate();
const worker = new Worker(queueName, processBulk, {
  connection: workerConnection,
  concurrency: workerConcurrency
});
worker.on("error", error => console.error("PDF worker error:", error));
queue.on("error", error => console.error("PDF queue error:", error));

const server = app.listen(port, () => console.log(`PDF service listening at http://localhost:${port}`));

async function shutdown() {
  await Promise.allSettled([
    worker.close(),
    queue.close(),
    closePdfBrowser(),
    workerConnection.quit(),
    redisConnection.quit(),
  ]);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
