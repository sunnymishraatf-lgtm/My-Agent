import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./config";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface LoggerBridge {
  log(level: LogLevel, channel: string, msg: string, meta?: Record<string, unknown>): void;
}

export class FileLogger implements Logger, LoggerBridge {
  private dir: string;
  private file: string;
  minLevel: LogLevel = "info";

  constructor(dir: string, channel: string) {
    this.dir = dir;
    this.file = join(dir, `${channel}.log`);
  }

  log(level: LogLevel, _channel: string, msg: string, meta?: Record<string, unknown>): void {
    if (levelOrder[level] < levelOrder[this.minLevel]) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${redact(msg)}`
        + (meta ? ` ${redact(JSON.stringify(meta))}` : "");
      appendFileSync(this.file, line + "\n", "utf8");
    } catch {
      /* logging never throws */
    }
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.log("debug", this.file, msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>): void {
    this.log("info", this.file, msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.log("warn", this.file, msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>): void {
    this.log("error", this.file, msg, meta);
  }
}

export class ConsoleLogger implements Logger {
  minLevel: LogLevel = "info";
  debug(msg: string): void {
    if (levelOrder.debug < levelOrder[this.minLevel]) return;
    process.stdout.write(redact(`[debug] ${msg}\n`));
  }
  info(msg: string): void {
    if (levelOrder.info < levelOrder[this.minLevel]) return;
    process.stdout.write(redact(`${msg}\n`));
  }
  warn(msg: string): void {
    process.stdout.write(redact(`⚠ ${msg}\n`));
  }
  error(msg: string): void {
    process.stderr.write(redact(`✖ ${msg}\n`));
  }
}

export class MultiLogger implements Logger {
  private sinks: Logger[];
  constructor(sinks: Logger[]) {
    this.sinks = sinks;
  }
  debug(msg: string, meta?: Record<string, unknown>): void {
    for (const s of this.sinks) s.debug(msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>): void {
    for (const s of this.sinks) s.info(msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    for (const s of this.sinks) s.warn(msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>): void {
    for (const s of this.sinks) s.error(msg, meta);
  }
}

export function createLogger(dir: string, channel: string, consoleOnly = false): Logger {
  if (consoleOnly) return new ConsoleLogger();
  return new MultiLogger([new ConsoleLogger(), new FileLogger(dir, channel)]);
}