import type { ChatSession } from "./session";

export interface TokenEstimate {
  messages: number;
  characters: number;
  tokens: number;
}

/** Rough token estimate (~4 characters per token) for a session transcript. */
export function estimateTokens(session: ChatSession): TokenEstimate {
  const characters = session.messages.reduce((n, m) => n + m.content.length, 0);
  return { messages: session.messages.length, characters, tokens: Math.ceil(characters / 4) };
}

export function formatTranscript(session: ChatSession, opts?: { includeTools?: boolean }): string {
  const includeTools = opts?.includeTools ?? true;
  const lines: string[] = [];
  for (const message of session.messages) {
    const role = message.role === "user" ? "You" : message.role === "assistant" ? "NEUTRON" : message.role;
    const content = message.content.trim();
    if (!content) continue;
    if (!includeTools && role !== "You" && role !== "NEUTRON") continue;
    lines.push(`**${role}**`, "", content, "");
  }
  return lines.join("\n").trimEnd();
}

export function sessionToMarkdown(session: ChatSession): string {
  const { tokens } = estimateTokens(session);
  const header = [
    `# ${session.title}`,
    "",
    `- Session: \`${session.id}\``,
    `- Created: ${session.createdAt}`,
    `- Updated: ${session.updatedAt}`,
    session.model ? `- Model: ${session.model}` : undefined,
    session.provider ? `- Provider: ${session.provider}` : undefined,
    `- Approx. tokens: ${tokens}`,
    "",
    "---",
    "",
  ].filter((line): line is string => line !== undefined);
  return `${header.join("\n")}${formatTranscript(session)}\n`;
}
