import { describe, it, expect } from "vitest";
import { ConcurrencyLimit } from "../src/api/pool";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("ConcurrencyLimit", () => {
  it("runs at most N concurrently", async () => {
    const pool = new ConcurrencyLimit(2);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () =>
      pool.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await delay(10);
        active--;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("queues tasks beyond the limit", async () => {
    const pool = new ConcurrencyLimit(1);
    let counter = 0;
    const order: number[] = [];
    const jobs = Array.from({ length: 5 }, (_, i) =>
      pool.run(async () => {
        order.push(i);
        counter++;
        await delay(1);
      }),
    );
    await Promise.all(jobs);
    expect(order.length).toBe(5);
    expect(counter).toBe(5);
  });

  it("supports resize widening", async () => {
    const pool = new ConcurrencyLimit(1);
    let active = 0;
    let peak = 0;
    pool.width(3);
    const jobs = Array.from({ length: 4 }, () =>
      pool.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await delay(5);
        active--;
      }),
    );
    await Promise.all(jobs);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("widening wakes only the newly-enabled number of waiters, in FIFO order", async () => {
    const pool = new ConcurrencyLimit(1);
    const started: number[] = [];
    const release: Array<() => void> = [];
    const jobs = Array.from({ length: 6 }, (_, i) =>
      pool.run(async () => {
        started.push(i);
        await new Promise<void>((r) => {
          release.push(r);
        });
      }),
    );
    await delay(10);
    expect(pool.running).toBe(1);
    expect(pool.queued).toBe(5);

    pool.width(3);
    await delay(10);
    // Exactly delta = 3 - 1 = 2 more jobs started: 3 running total.
    expect(pool.running).toBe(3);
    expect(pool.queued).toBe(3);
    expect(started).toEqual([0, 1, 2]);

    // Narrowing never preempts running jobs; bookkeeping stays consistent.
    pool.width(1);
    expect(pool.running).toBe(3);
    // Drain: each release admits one waiter (max is now 1), so keep releasing
    // until every job has started and finished.
    const deadline = Date.now() + 5000;
    while (started.length < 6 || pool.running > 0 || pool.queued > 0) {
      if (Date.now() > deadline) throw new Error("pool did not drain");
      release.splice(0).forEach((r) => r());
      await delay(5);
    }
    await Promise.all(jobs);
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pool.running).toBe(0);
    expect(pool.queued).toBe(0);
  });

  it("widening past the queue length does not over-admit", async () => {
    const pool = new ConcurrencyLimit(1);
    const release: Array<() => void> = [];
    const jobs = Array.from({ length: 3 }, () =>
      pool.run(
        () =>
          new Promise<void>((r) => {
            release.push(r);
          }),
      ),
    );
    await delay(10);
    pool.width(10);
    await delay(10);
    expect(pool.running).toBe(3);
    expect(pool.queued).toBe(0);
    release.forEach((r) => r());
    await Promise.all(jobs);
  });
});