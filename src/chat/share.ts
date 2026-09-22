import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatSession } from "./session";

export function shareSession(root: string, session: ChatSession): { file: string; json: string } {
  const dir = join(root, ".agent", "shares");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${session.id}.json`);
  const payload = { ...session, sharedAt: new Date().toISOString() };
  const json = JSON.stringify(payload, null, 2);
  writeFileSync(file, json, "utf8");
  return { file, json };
}
