const { describe, it, expect } = require("vitest");
const request = require("supertest");
const app = require("../server");
const { issueToken } = require("../src/services/token");

describe("tasks", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/tasks");
    expect(res.statusCode).toBe(401);
  });
  it("lists and creates tasks with a token", async () => {
    const token = issueToken({ id: 1, email: "a@b.c" });
    const create = await request(app).post("/api/tasks").set("authorization", `Bearer ${token}`).send({ title: "Do it" });
    expect(create.statusCode).toBe(201);
    const list = await request(app).get("/api/tasks").set("authorization", `Bearer ${token}`);
    expect(list.statusCode).toBe(200);
  });
});
