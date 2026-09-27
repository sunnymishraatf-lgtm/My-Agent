const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const tasks = require("../db/tasks");

router.get("/", requireAuth, async (req, res) => {
  const items = await tasks.listByUser(req.user.id);
  res.json({ tasks: items });
});

router.post("/", requireAuth, async (req, res) => {
  const task = await tasks.insert({ ownerId: req.user.id, title: req.body.title });
  res.status(201).json({ task });
});

module.exports = router;
