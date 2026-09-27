export interface NeutronClientOptions {
  baseUrl: string;
  username?: string;
  password?: string;
  fetchImpl?: typeof fetch;
}

export interface ChatResult {
  ok: boolean;
  text: string;
  sessionId: string;
}

export interface AgentInfo {
  name: string;
  description: string;
  mode: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  agents: string[];
}

/** Programmatic client for a running `neutron serve` instance. */
export class NeutronClient {
  private base: string;
  private headers: Record<string, string>;
  private fetchImpl: typeof fetch;

  constructor(opts: NeutronClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.headers = { "content-type": "application/json" };
    if (opts.password) {
      const token = Buffer.from(`${opts.username ?? "neutron"}:${opts.password}`).toString("base64");
      this.headers.authorization = `Basic ${token}`;
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      ...init,
      headers: { ...this.headers, ...(init?.headers ?? {}) },
    });
    const data = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `Request failed with status ${res.status}`);
    return data;
  }

  health(): Promise<HealthInfo> {
    return this.request<HealthInfo>("/health");
  }

  async agents(): Promise<AgentInfo[]> {
    const data = await this.request<{ agents: AgentInfo[] }>("/v1/agents");
    return data.agents;
  }

  async sessions(): Promise<SessionInfo[]> {
    const data = await this.request<{ sessions: SessionInfo[] }>("/v1/sessions");
    return data.sessions;
  }

  chat(
    message: string,
    opts?: { sessionId?: string; model?: string; provider?: string; agent?: string },
  ): Promise<ChatResult> {
    return this.request<ChatResult>("/v1/chat", {
      method: "POST",
      body: JSON.stringify({ message, ...opts }),
    });
  }
}

export function createClient(opts: NeutronClientOptions): NeutronClient {
  return new NeutronClient(opts);
}
