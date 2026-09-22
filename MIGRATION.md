# Migrating from SUN / SUNNY to NEUTRON

| Old | New | Compatibility |
|---|---|---|
| `sunny` command | `neutron` | `sunny` still works (prints a deprecation note) |
| `sunny sun "..."` | `neutron maintain "..."` | `neutron sun` remains as a hidden alias |
| `SUNNY_*` env vars | `NEUTRON_*` | `SUNNY_*` is read as a fallback |
| global config dir `sunny` | `neutron` | the legacy dir is used automatically if the new one does not exist |
| project `.sunny/` (skills, commands, plugins, agents, mcp/lsp json, tools, rules) | `.neutron/` | both are read; `.neutron` wins |
| `.agent/sun/` run history | `.agent/neutron/` | the legacy dir keeps being used if it is the only one |
| `sun/checkpoint/*` git branches | `neutron/checkpoint/*` | legacy branches are still recognised |
| `/api/sun/*` | `/api/neutron/*` | no alias (internal dashboard API) |
| npm package `sunny-agent` | `neutron-agent` | both bins (`neutron`, `sunny`) ship in the package |

Decisions
* The internal directory `src/sun` was renamed to `src/neutron` and all imports updated (typecheck and tests verify this).
* `repository`, `homepage` and `bugs` URLs in `package.json`, and the install-script URLs, still point at `sunny-ai/sunny-agent`: the final repository location is not known. Update them when it exists.
* The HTTP API never accepts a client-supplied blanket auto-approve. Code-changing runs require a stored plan and an explicit plan approval; command approvals are only available in the CLI/TUI.
