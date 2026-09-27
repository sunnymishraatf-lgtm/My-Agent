const express = require("express");
const router = express.Router();
const passport = require("passport");
const { issueToken } = require("../services/token");
const { verify } = require("../services/password");
const users = require("../db/users");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await users.findByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const ok = await verify(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    res.json({ token: issueToken(user), user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    const hashService = require("../services/password");
    const passwordHash = await hashService.hash(password);
    const user = await users.insert({ email, passwordHash });
    res.status(201).json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    const token = issueToken(req.user);
    res.json({ token, user: { id: req.user.id, email: req.user.email } });
  }
);

module.exports = router;
