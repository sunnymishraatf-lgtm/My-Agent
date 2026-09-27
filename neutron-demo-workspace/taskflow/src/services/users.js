const users = require("../db/users");

async function createUser({ email, password }) {
  const existing = await users.findByEmail(email);
  if (existing) throw new Error("EMAIL_TAKEN");
  return users.insert({ email, password });
}

async function findById(id) {
  return users.findById(id);
}

module.exports = { createUser, findById };
