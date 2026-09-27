export class ConcurrencyLimit {
  private max: number;
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.max = Math.max(1, max);
  }

  get running(): number {
    return this.active;
  }

  get queued(): number {
    return this.queue.length;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.active < this.max) {
        this.active++;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }

  width(newMax: number): void {
    const clamped = Math.max(1, newMax);
    const delta = clamped - this.max;
    this.max = clamped;
    if (delta > 0) {
      // Wake only the newly-enabled number of waiters, in FIFO order.
      const wake = Math.min(delta, this.queue.length);
      for (let i = 0; i < wake; i++) {
        this.active++;
        this.queue.shift()!();
      }
    }
  }
}