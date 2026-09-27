import { SessionStore } from "../chat/session";

export interface SessionsCommandOptions {
  root: string;
  show?: string;
  delete?: string;
  rename?: string;
  title?: string;
  search?: string;
  fork?: string;
  at?: number;
  prune?: boolean;
  keep?: number;
  json?: boolean;
}

export function sessionsCommand(opts: SessionsCommandOptions): void {
  const store = new SessionStore(opts.root);

  if (opts.prune) {
    const keep = typeof opts.keep === "number" ? opts.keep : 10;
    const removed = store.prune(keep);
    console.log(`Pruned ${removed} session(s), kept the most recent ${keep}.`);
    return;
  }

  if (opts.fork) {
    const forked = store.fork(opts.fork, {
      ...(opts.title ? { title: opts.title } : {}),
      ...(typeof opts.at === "number" ? { atMessage: opts.at } : {}),
    });
    if (!forked) {
      console.log(`Session not found: ${opts.fork}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Forked ${opts.fork} -> ${forked.id} ("${forked.title}")`);
    return;
  }

  if (opts.rename) {
    if (!opts.title) {
      console.log("Provide --title with --rename.");
      process.exitCode = 1;
      return;
    }
    const renamed = store.rename(opts.rename, opts.title);
    console.log(renamed ? `Renamed ${opts.rename} to "${opts.title}".` : `Session not found: ${opts.rename}.`);
    if (!renamed) process.exitCode = 1;
    return;
  }

  if (opts.delete) {
    const removed = store.remove(opts.delete);
    console.log(removed ? `Deleted session ${opts.delete}.` : `Session not found: ${opts.delete}.`);
    if (!removed) process.exitCode = 1;
    return;
  }

  if (opts.show) {
    const session = store.load(opts.show);
    if (!session) {
      console.log(`Session not found: ${opts.show}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Session ${session.id}`);
    console.log(`Title: ${session.title}`);
    console.log(`Updated: ${session.updatedAt}\n`);
    for (const message of session.messages) {
      console.log(`[${message.role}] ${message.content}`);
      console.log("");
    }
    return;
  }

  const sessions = opts.search ? store.search(opts.search) : store.list();
  if (opts.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }
  if (sessions.length === 0) {
    console.log(
      opts.search ? `No sessions matching "${opts.search}".` : "No chat sessions yet. Start one with `neutron chat`.",
    );
    return;
  }
  console.log(opts.search ? `Chat sessions matching "${opts.search}":\n` : "Chat sessions:\n");
  for (const s of sessions) {
    console.log(`  ${s.id}  ${s.updatedAt}  ${s.title} (${s.messageCount} messages)`);
  }
  console.log("\nResume with `neutron chat --session <id>` or `neutron chat --continue`.");
}
