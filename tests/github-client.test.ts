/**
 * GitHub client tests: pure helpers in src/web/app/ui-utils.js.
 * The request core (githubRequest) is tested with an injected mock fetch:
 * URLs correct, Authorization header present, 401/403 mapped to friendly
 * guidance, and the token never leaks into errors or logs.
 */
import { describe, it, expect, vi } from "vitest";
import ui from "../src/web/app/ui-utils.js";

const {
  githubApiUrl,
  githubAuthHeaders,
  githubErrorMessage,
  githubRepoUrlOk,
  redactGithubToken,
  githubRequest,
  redactSecrets,
} = ui;

describe("githubApiUrl", () => {
  it("prefixes the API base", () => {
    expect(githubApiUrl("/user/repos")).toBe("https://api.github.com/user/repos");
  });
  it("adds a missing leading slash", () => {
    expect(githubApiUrl("user")).toBe("https://api.github.com/user");
  });
});

describe("githubAuthHeaders", () => {
  it("sends the token as a Bearer Authorization header", () => {
    const h = githubAuthHeaders("tok123");
    expect(h["Authorization"]).toBe("Bearer tok123");
    expect(h["Accept"]).toContain("application/vnd.github+json");
  });
  it("never puts the token anywhere else", () => {
    const h = githubAuthHeaders("tok123");
    const all = JSON.stringify(h);
    expect(all.split("tok123").length - 1).toBe(1); // exactly once
  });
});

describe("githubErrorMessage", () => {
  it("maps 401 to token guidance", () => {
    const m = githubErrorMessage(401, '{"message":"Bad credentials"}');
    expect(m).toMatch(/401/);
    expect(m).toMatch(/token/i);
    expect(m).toContain("Bad credentials");
  });
  it("maps 403 rate limits distinctly from permission denials", () => {
    expect(githubErrorMessage(403, '{"message":"API rate limit exceeded"}')).toMatch(/rate limit/i);
    expect(githubErrorMessage(403, '{"message":"Resource not accessible"}')).toMatch(/permission/i);
  });
  it("maps 404 and 422 honestly", () => {
    expect(githubErrorMessage(404, "")).toMatch(/404/);
    expect(githubErrorMessage(422, '{"message":"Validation failed"}')).toContain("Validation failed");
  });
  it("never includes a token", () => {
    const m = githubErrorMessage(401, "token=tok123 Bad credentials");
    expect(m).not.toContain("tok123");
  });
});

describe("githubRepoUrlOk", () => {
  it("accepts github https urls", () => {
    expect(githubRepoUrlOk("https://github.com/owner/repo")).toBe(true);
    expect(githubRepoUrlOk("https://github.com/owner/repo.git")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(githubRepoUrlOk("https://evil.com/owner/repo")).toBe(false);
    expect(githubRepoUrlOk("git@github.com:owner/repo.git")).toBe(false);
    expect(githubRepoUrlOk("https://github.com/owner")).toBe(false);
    expect(githubRepoUrlOk("")).toBe(false);
  });
});

describe("redactGithubToken", () => {
  it("replaces the token everywhere", () => {
    expect(redactGithubToken("Bearer tok123 then tok123", "tok123")).toBe("Bearer [redacted] then [redacted]");
  });
  it("is a no-op without a token", () => {
    expect(redactGithubToken("hello", "")).toBe("hello");
  });
});

describe("redactSecrets", () => {
  it("redacts a token key in logged bodies", () => {
    expect(redactSecrets('{"url":"x","token":"tok123"}')).toBe('{"url":"x","token":"***"}');
    expect(redactSecrets('{"token":"tok123"}')).not.toContain("tok123");
  });
});

describe("githubRequest", () => {
  function okFetch(payload: unknown, status = 200) {
    return vi.fn(async () => ({ status, text: async () => JSON.stringify(payload) }));
  }

  it("calls the right URL with the Authorization header", async () => {
    const fetch = okFetch({ login: "sunny" });
    const res = await githubRequest("/user", "tok123", {}, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.github.com/user");
    expect(init.headers["Authorization"]).toBe("Bearer tok123");
    expect(res).toEqual({ login: "sunny" });
  });

  it("sends POST bodies as JSON", async () => {
    const fetch = okFetch({ number: 7 }, 201);
    await githubRequest("/repos/o/r/issues", "tok", { method: "POST", body: { title: "hi" } }, fetch);
    const [, init] = fetch.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ title: "hi" });
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("maps a 401 to friendly guidance without the token", async () => {
    const fetch = okFetch({ message: "Bad credentials" }, 401);
    await expect(githubRequest("/user", "tok123", {}, fetch)).rejects.toThrow(/401/);
    try {
      await githubRequest("/user", "tok123", {}, fetch);
    } catch (e) {
      expect((e as Error).message).not.toContain("tok123");
      expect((e as Error).message).toMatch(/token/i);
    }
  });

  it("maps a 403 rate limit honestly", async () => {
    const fetch = okFetch({ message: "API rate limit exceeded for user" }, 403);
    await expect(githubRequest("/user", "tok", {}, fetch)).rejects.toThrow(/rate limit/i);
  });

  it("rejects when no token is connected", async () => {
    const fetch = okFetch({});
    await expect(githubRequest("/user", "", {}, fetch)).rejects.toThrow(/not connected/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("scrubs the token even from transport errors", async () => {
    const fetch = vi.fn(async () => { throw new Error("socket hung up (tok123)"); });
    await expect(githubRequest("/user", "tok123", {}, fetch)).rejects.toThrow(/socket hung up \(\[redacted\]\)/);
  });
});
