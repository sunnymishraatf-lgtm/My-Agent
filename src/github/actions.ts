import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { ApiSystem } from "../api/api-manager";
import { ChatAgent } from "../chat/agent";

export interface GitHubEventContext {
  repo?: string;
  issueNumber?: number;
  isPullRequest?: boolean;
  prompt: string;
  actor?: string;
}

export interface RunGitHubOptions {
  eventName: string;
  event: Record<string, unknown>;
  token?: string;
  prompt?: string;
  api?: ApiSystem;
}

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const WORKFLOW = `name: neutron

on:
  issues:
    types: [opened]
  issue_comment:
    types: [created]
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  neutron:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install -g neutron-agent
      - run: neutron github run
        env:
          NEUTRON_API_KEY: \${{ secrets.NEUTRON_API_KEY }}
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          OPENAI_BASE_URL: \${{ secrets.OPENAI_BASE_URL }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

export function installGitHubWorkflow(root: string): { path: string; created: boolean } {
  const dir = join(root, ".github", "workflows");
  const path = join(dir, "neutron.yml");
  if (existsSync(path)) return { path, created: false };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, WORKFLOW, "utf8");
  return { path, created: true };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseGitHubEvent(eventName: string, event: Record<string, unknown>): GitHubEventContext {
  const repository = (event.repository ?? {}) as Record<string, unknown>;
  const repo = str(repository.full_name);
  const actor = str((event.sender as Record<string, unknown> | undefined)?.login);

  if (eventName === "issues") {
    const issue = (event.issue ?? {}) as Record<string, unknown>;
    const number = typeof issue.number === "number" ? issue.number : undefined;
    const title = str(issue.title);
    const body = str(issue.body);
    return {
      repo,
      issueNumber: number,
      actor,
      prompt: `An issue was opened${number ? ` (#${number})` : ""}. Title: ${title}\n\n${body}\n\nInvestigate and implement a fix. Run the project's tests. Then summarize the change.`,
    };
  }

  if (eventName === "issue_comment") {
    const issue = (event.issue ?? {}) as Record<string, unknown>;
    const comment = (event.comment ?? {}) as Record<string, unknown>;
    const number = typeof issue.number === "number" ? issue.number : undefined;
    const isPullRequest = Boolean(issue.pull_request);
    return {
      repo,
      issueNumber: number,
      isPullRequest,
      actor,
      prompt: `A new comment was posted${number ? ` on #${number}` : ""}:\n\n${str(comment.body)}\n\nRespond by making the requested changes if applicable, and reply with a short summary.`,
    };
  }

  if (eventName === "pull_request") {
    const pr = (event.pull_request ?? {}) as Record<string, unknown>;
    const number = typeof pr.number === "number" ? pr.number : undefined;
    return {
      repo,
      issueNumber: number,
      isPullRequest: true,
      actor,
      prompt: `Pull request${number ? ` #${number}` : ""} "${str(pr.title)}" was updated. Review the diff, fix obvious problems, and run the tests.`,
    };
  }

  return { repo, actor, prompt: `GitHub event: ${eventName}` };
}

export async function postIssueComment(repo: string, issueNumber: number, body: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "neutron-agent",
      },
      body: JSON.stringify({ body }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runGitHubAction(
  root: string,
  opts: RunGitHubOptions,
): Promise<{ text: string; context: GitHubEventContext; commented: boolean }> {
  const context = parseGitHubEvent(opts.eventName, opts.event);
  const api = opts.api ?? new ApiSystem({ config: loadConfig(), logger: silentLogger });
  const now = new Date().toISOString();
  const agent = new ChatAgent({ root, api, autoApprove: true, stream: false, formatOnWrite: false });
  const text = await agent.send(
    { id: `gh-${Date.now().toString(36)}`, title: opts.eventName, createdAt: now, updatedAt: now, messages: [] },
    opts.prompt ?? context.prompt,
  );
  let commented = false;
  if (opts.token && context.repo && context.issueNumber) {
    commented = await postIssueComment(context.repo, context.issueNumber, text, opts.token);
  }
  return { text, context, commented };
}

export function readEventFromEnv(): { eventName: string; event: Record<string, unknown> } | undefined {
  const path = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME ?? "issues";
  if (!path || !existsSync(path)) return undefined;
  try {
    return { eventName, event: JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> };
  } catch {
    return undefined;
  }
}
