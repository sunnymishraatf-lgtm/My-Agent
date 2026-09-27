const { MAP } = require("./index");

const users = [];

async function findByEmail(email) {
  return users.find((u) => u.email === email) || null;
}

async function findById(id) {
  return users.find((u) => u.id === id) || null;
}

async function insert({ email, passwordHash }) {
  const user = { id: users.length + 1, email, passwordHash, createdAt: new Date().toISOString() };
  users.push(user);
  return user;
}

module.exports = { findByEmail, findById, insert };
