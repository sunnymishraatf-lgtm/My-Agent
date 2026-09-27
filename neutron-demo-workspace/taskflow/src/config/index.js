const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

module.exports = {
  sessionSecret: process.env.SESSION_SECRET || "dev-secret",
  jwtSecret: process.env.JWT_SECRET || "dev-jwt",
  databaseUrl: process.env.DATABASE_URL || "postgres://localhost:5432/taskflow",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/api/auth/google/callback",
  },
};
