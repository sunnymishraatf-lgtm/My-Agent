import { describe, it, expect } from "vitest";
import { classify } from "../src/terminal/terminal";
import { redact, registerSecrets } from "../src/config";

describe("terminal classify", () => {
  it("flags recursive deletes", () => {
    expect(classify("rm -rf /tmp/x").requiresApproval).toBe(true);
    expect(classify("rm -rf /tmp/x").reason).toBe("dangerous-command");
  });

  it("flags drop table", () => {
    expect(classify("psql -c 'DROP TABLE users;'").requiresApproval).toBe(true);
    expect(classify("psql -c 'DROP TABLE users;'").reason).toBe("destructive");
  });

  it("flags force push", () => {
    expect(classify("git push --force origin main").requiresApproval).toBe(true);
  });

  it("does not flag safe commands", () => {
    expect(classify("npm test").requiresApproval).toBe(false);
    expect(classify("git status").requiresApproval).toBe(false);
  });
});

describe("redact", () => {
  it("hides registered secrets", () => {
    registerSecrets(["sk-secretvalue123456"]);
    const out = redact("Bearer sk-secretvalue123456 and other");
    expect(out).not.toContain("sk-secretvalue123456");
    expect(out).toContain("****************");
  });

  it("hides openai-style patterns", () => {
    const out = redact("key is sk-1234567890ABCDEFGHIJKL1234");
    expect(out).toContain("****************");
  });

  it("leaves short strings alone", () => {
    expect(redact("hello world")).toBe("hello world");
  });
});