const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config");

function issueToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: "7d" });
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

module.exports = { issueToken, verifyToken };
