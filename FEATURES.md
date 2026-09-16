# sunny feature checklist — 100 / 100 shipped

`[x]` = shipped.

## Project workflow (1-10)
1. [x] `sunny init` project scaffolding (`--force`)
2. [x] `sunny design` create/check `design.md`
3. [x] `sunny plan` task graph generation
4. [x] `sunny run` multi-agent execution (TUI/plain/JSON)
5. [x] `sunny status` agent/task status
6. [x] `sunny review` reviewer agent
7. [x] `sunny test` project test runner
8. [x] `sunny fix` retry failed tasks
9. [x] `sunny doctor` environment/provider checks
10. [x] `sunny design --check` design validation

## Providers & config (11-20)
11. [x] `sunny config` interactive wizard
12. [x] `sunny config --add/--remove/--enable/--disable`
13. [x] `sunny config --show` resolved config (redacted)
14. [x] `sunny auth login/list/logout`
15. [x] `sunny models` (with `--json`)
16. [x] Env-var providers (`LLM_`, `GROQ_`, `OPENAI_`, ...)
17. [x] Provider failover + cooldowns
18. [x] Free-model auto-preference
19. [x] Streaming with pre-delta fallback
20. [x] `SUNNY_CONFIG_DIR` override

## Interactive coding agent (21-45)
21. [x] `sunny chat` REPL + one-shot
22. [x] Streaming responses (`--no-stream`)
23. [x] read/write/edit/list/glob/grep/bash tools
24. [x] `webfetch` tool
25. [x] `task` subagent tool
26. [x] `todowrite`/`todoread`
27. [x] `skill` tool
28. [x] `lsp` diagnostics tool
29. [x] MCP server tools
30. [x] Custom command tools
31. [x] Auto-formatters after write/edit
32. [x] Auto-compaction + `/compact`
33. [x] Session persistence
34. [x] Undo/redo snapshots
35. [x] Custom slash commands
36. [x] `@file` input helper
37. [x] `!shell` input helper
38. [x] Agents + modes + permissions
39. [x] Skills (`.sunny/skills`)
40. [x] Rules injection (`.sunny/rules`)
41. [x] `/init` AGENTS.md generation
42. [x] `/model`, `/provider` switching
43. [x] `/rename`, `/search`, `/fork`
44. [x] `/diff` unified diff viewer
45. [x] `/plugins` listing

## Sessions (46-55)
46. [x] `sunny sessions list/show/delete`
47. [x] `sunny sessions --search`
48. [x] `sunny sessions --rename`
49. [x] `sunny sessions --fork [--at]`
50. [x] `sunny undo` / `sunny redo`
51. [x] `sunny diff`
52. [x] `sunny export` / `sunny import`
53. [x] `sunny share`
54. [x] `sunny stats`
55. [x] `sunny replay` (re-print a session transcript)

## Agents & extensions (56-65)
56. [x] `sunny agent list/create/show/delete`
57. [x] Built-in build/plan/general/explore agents
58. [x] Markdown agent files
59. [x] Permission overrides (`--allow`/`--deny`)
60. [x] Plugin hooks (`chat.message`, `tool.before/after`)
61. [x] Global-config plugin list
62. [x] `sunny plugin list/add/remove`
63. [x] MCP client + `sunny mcp list/add`
64. [x] LSP client + `sunny lsp list`
65. [x] GitHub Actions integration

## Interfaces (66-75)
66. [x] Headless HTTP server (`sunny serve`)
67. [x] Web chat UI (`sunny web`)
68. [x] ACP stdio server (`sunny acp`)
69. [x] JS/TS SDK client
70. [x] CLI color themes
71. [x] REPL banner + prompt
72. [x] REPL status line / spinner
73. [x] NDJSON event output for chat (`--stream-json`)
74. [x] NDJSON streaming endpoint (`POST /v1/chat/stream`)
75. [x] OpenAI-compatible inbound shim (`POST /v1/chat/completions`)

## Utilities (76-100)
76. [x] `sunny fmt` formatter runner
77. [x] `sunny env` environment summary
78. [x] `sunny tokens` session token estimate
79. [x] `sunny grep` code search
80. [x] `sunny find` glob file search
81. [x] `sunny export --md` Markdown transcript
82. [x] `sunny sessions --prune --keep N`
83. [x] `sunny init --force`
84. [x] `sunny completion` shell completion
85. [x] Config `--get`/`--set` dotted keys
86. [x] `sunny alias` command shortcuts
87. [x] Chat `/clear`, `/save`, `/export`, `/tokens`
88. [x] Model listing per provider (`--json`)
89. [x] `sunny upgrade` / `sunny self-update`
90. [x] `sunny logs`, `sunny stop`, `sunny resume`
91. [x] Themed help output
92. [x] Per-session model/provider persistence
93. [x] Tool output trimming + `--max-tool-output`
94. [x] `sunny serve` auth + CORS
95. [x] Web UI session list + agent picker
96. [x] Web UI streaming responses
97. [x] `sunny watch` re-run on file change
98. [x] `sunny bench` local latency benchmark
99. [x] `sunny self-update` check
100. [x] Full test suite (109 tests / 21 files) + docs
