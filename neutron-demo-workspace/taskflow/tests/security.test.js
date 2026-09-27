const { describe, it, expect } = require("vitest");

describe("security posture", () => {
  it("uses safe password hashing", async () => {
    const pw = require("../src/services/password");
    const hash = await pw.hash("secret123");
    expect(hash).not.toContain("secret123");
    expect(await pw.verify("secret123", hash)).toBe(true);
  });
});
