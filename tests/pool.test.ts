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
});