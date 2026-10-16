import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

test("BullMQ retries a failed job and completes it", async () => {
  const queueName = `retry-test-${randomUUID()}`;
  const connection = new IORedis(
    process.env.REDIS_URL || "redis://127.0.0.1:6379",
    { maxRetriesPerRequest: null },
  );
  const workerConnection = connection.duplicate();
  const queue = new Queue(queueName, { connection });
  let attemptsSeen = 0;
  let worker;

  try {
    worker = new Worker(
      queueName,
      async () => {
        attemptsSeen++;
        if (attemptsSeen < 3) throw new Error("Intentional test failure");
        return { status: "completed" };
      },
      { connection: workerConnection, concurrency: 1 },
    );

    await worker.waitUntilReady();

    const job = await queue.add(
      "retry-test",
      {},
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 100 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    const deadline = Date.now() + 10000;
    let state = await job.getState();

    while (
      state !== "completed" &&
      state !== "failed" &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = await job.getState();
    }

    assert.equal(state, "completed");
    assert.equal(attemptsSeen, 3);

    const finishedJob = await queue.getJob(job.id);

    console.log("Attempts observed:", attemptsSeen);
    console.log("Final state:", state);
    console.log("Return value:", finishedJob?.returnvalue);
    console.log("Failure reason:", finishedJob?.failedReason);

    assert.deepEqual(finishedJob.returnvalue, { status: "completed" });
  } finally {
    if (worker) await worker.close();
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await workerConnection.quit();
    await connection.quit();
  }
});
