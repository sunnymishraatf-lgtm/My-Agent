const bcrypt = require("bcryptjs");

async function hash(plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

async function verify(plain, hashed) {
  return bcrypt.compare(plain, hashed);
}

module.exports = { hash, verify };
