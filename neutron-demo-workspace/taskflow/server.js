const express = require("express");
const session = require("express-session");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.get("/health", (req, res) => res.json({ ok: true }));

const authRoutes = require("./src/routes/auth");
app.use("/api/auth", authRoutes);

const userRoutes = require("./src/routes/users");
app.use("/api/users", userRoutes);

const taskRoutes = require("./src/routes/tasks");
app.use("/api/tasks", taskRoutes);

module.exports = app;
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TaskFlow listening on :${PORT}`));
