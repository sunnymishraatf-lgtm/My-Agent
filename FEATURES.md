# neutron feature checklist — 100 / 100 shipped

`[x]` = shipped.

## Project workflow (1-10)
1. [x] `neutron init` project scaffolding (`--force`)
2. [x] `neutron design` create/check `design.md`
3. [x] `neutron plan` task graph generation
4. [x] `neutron run` multi-agent execution (TUI/plain/JSON)
5. [x] `neutron status` agent/task status
6. [x] `neutron review` reviewer agent
7. [x] `neutron test` project test runner
8. [x] `neutron fix` retry failed tasks
9. [x] `neutron doctor` environment/provider checks
10. [x] `neutron design --check` design validation

## Providers & config (11-20)
11. [x] `neutron config` interactive wizard
12. [x] `neutron config --add/--remove/--enable/--disable`
13. [x] `neutron config --show` resolved config (redacted)
14. [x] `neutron auth login/list/logout`
15. [x] `neutron models` (with `--json`)
16. [x] Env-var providers (`LLM_`, `GROQ_`, `OPENAI_`, ...)
17. [x] Provider failover + cooldowns
18. [x] Free-model auto-preference
19. [x] Streaming with pre-delta fallback
20. [x] `NEUTRON_CONFIG_DIR` override

## Interactive coding agent (21-45)
21. [x] `neutron chat` REPL + one-shot
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
39. [x] Skills (`.neutron/skills`)
40. [x] Rules injection (`.neutron/rules`)
41. [x] `/init` AGENTS.md generation
42. [x] `/model`, `/provider` switching
43. [x] `/rename`, `/search`, `/fork`
44. [x] `/diff` unified diff viewer
45. [x] `/plugins` listing

## Sessions (46-55)
46. [x] `neutron sessions list/show/delete`
47. [x] `neutron sessions --search`
48. [x] `neutron sessions --rename`
49. [x] `neutron sessions --fork [--at]`
50. [x] `neutron undo` / `neutron redo`
51. [x] `neutron diff`
52. [x] `neutron export` / `neutron import`
53. [x] `neutron share`
54. [x] `neutron stats`
55. [x] `neutron replay` (re-print a session transcript)

## Agents & extensions (56-65)
56. [x] `neutron agent list/create/show/delete`
57. [x] Built-in build/plan/general/explore agents
58. [x] Markdown agent files
59. [x] Permission overrides (`--allow`/`--deny`)
60. [x] Plugin hooks (`chat.message`, `tool.before/after`)
61. [x] Global-config plugin list
62. [x] `neutron plugin list/add/remove`
63. [x] MCP client + `neutron mcp list/add`
64. [x] LSP client + `neutron lsp list`
65. [x] GitHub Actions integration

## Interfaces (66-75)
66. [x] Headless HTTP server (`neutron serve`)
67. [x] Web chat UI (`neutron web`)
68. [x] ACP stdio server (`neutron acp`)
69. [x] JS/TS SDK client
70. [x] CLI color themes
71. [x] REPL banner + prompt
72. [x] REPL status line / spinner
73. [x] NDJSON event output for chat (`--stream-json`)
74. [x] NDJSON streaming endpoint (`POST /v1/chat/stream`)
75. [x] OpenAI-compatible inbound shim (`POST /v1/chat/completions`)

## Utilities (76-100)
76. [x] `neutron fmt` formatter runner
77. [x] `neutron env` environment summary
78. [x] `neutron tokens` session token estimate
79. [x] `neutron grep` code search
80. [x] `neutron find` glob file search
81. [x] `neutron export --md` Markdown transcript
82. [x] `neutron sessions --prune --keep N`
83. [x] `neutron init --force`
84. [x] `neutron completion` shell completion
85. [x] Config `--get`/`--set` dotted keys
86. [x] `neutron alias` command shortcuts
87. [x] Chat `/clear`, `/save`, `/export`, `/tokens`
88. [x] Model listing per provider (`--json`)
89. [x] `neutron upgrade` / `neutron self-update`
90. [x] `neutron logs`, `neutron stop`, `neutron resume`
91. [x] Themed help output
92. [x] Per-session model/provider persistence
93. [x] Tool output trimming + `--max-tool-output`
94. [x] `neutron serve` auth + CORS
95. [x] Web UI session list + agent picker
96. [x] Web UI streaming responses
97. [x] `neutron watch` re-run on file change
98. [x] `neutron bench` local latency benchmark
99. [x] `neutron self-update` check
100. [x] Full test suite (109 tests / 21 files) + docs
