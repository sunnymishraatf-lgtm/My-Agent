const { describe, it, expect } = require("vitest");
const request = require("supertest");
const app = require("../server");
const users = require("../src/db/users");

describe("auth", () => {
  it("registers a user", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "a@b.c", password: "secret123" });
    expect(res.statusCode).toBe(201);
  });
  it("logs in with valid credentials", async () => {
    await request(app).post("/api/auth/register").send({ email: "a@b.c", password: "secret123" });
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.c", password: "secret123" });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
  it("rejects invalid credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.c", password: "wrong" });
    expect(res.statusCode).toBe(401);
  });
});
