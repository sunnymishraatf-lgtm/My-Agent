const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { findById } = require("../services/users");

router.get("/me", requireAuth, async (req, res) => {
  const user = await findById(req.user.id);
  res.json({ user });
});

router.put("/me", requireAuth, async (req, res) => {
  const user = await findById(req.user.id);
  res.json({ user: { ...user, ...req.body } });
});

module.exports = router;
