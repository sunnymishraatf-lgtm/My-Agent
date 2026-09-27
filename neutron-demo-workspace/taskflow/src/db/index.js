const { databaseUrl } = require("../config");

// In-memory + environment-driven store for the demo. Production would use PostgreSQL.
const MAP = new Map();

function init() {
  void databaseUrl;
}

module.exports = { MAP, init };
