/**
 * Secret-redaction tests: redactSecrets() in src/web/app/ui-utils.js.
 * Guards the Developer Mode API inspector — nothing secret may reach the
 * log, including credentials embedded in a user-configured backend URL.
 */
import { describe, it, expect } from "vitest";
import uiUtils from "../src/web/app/ui-utils.js";

const { redactSecrets } = uiUtils;

describe("redactSecrets", () => {
  it("redacts JSON-quoted x-api-key values", () => {
    expect(redactSecrets('{"x-api-key": "sk-secret-123"}'))
      .toBe('{"x-api-key": "***"}');
  });

  it("redacts JSON-quoted apiKey values", () => {
    expect(redactSecrets('{"apiKey":"abc"}')).toBe('{"apiKey":"***"}');
  });

  it("redacts JSON-quoted ownerToken values", () => {
    expect(redactSecrets('{"ownerToken" : "tok"}'))
      .toBe('{"ownerToken" : "***"}');
  });

  it("redacts credentials embedded in a backend URL", () => {
    expect(redactSecrets("URL: https://admin:s3cret@example.com/api/chat"))
      .toBe("URL: https://***@example.com/api/chat");
  });

  it("redacts user-only userinfo", () => {
    expect(redactSecrets("https://token@host:8080/x"))
      .toBe("https://***@host:8080/x");
  });

  it("leaves plain URLs untouched", () => {
    const u = "https://neutron-agent.vercel.app/api/health";
    expect(redactSecrets(u)).toBe(u);
  });

  it("does not touch @ in URL paths", () => {
    const u = "https://host/api/@scope/pkg";
    expect(redactSecrets(u)).toBe(u);
  });

  it("handles non-string input without throwing", () => {
    expect(redactSecrets(null)).toBe("null");
    expect(redactSecrets(undefined)).toBe("undefined");
    expect(redactSecrets(42)).toBe("42");
  });

  it("redacts every occurrence, not just the first", () => {
    const s = '{"x-api-key": "a"} and {"x-api-key": "b"}';
    expect(redactSecrets(s)).toBe('{"x-api-key": "***"} and {"x-api-key": "***"}');
  });
});
