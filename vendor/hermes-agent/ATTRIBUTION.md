# Attribution — vendored Hermes Agent

This directory contains the complete **Hermes Agent** open-source project by
[Nous Research](https://nousresearch.com)
([github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)),
vendored verbatim for reference and integration.

- **License:** MIT License — see `LICENSE` in this directory.
  Copyright (c) 2025 Nous Research.
- **Contents:** Python agent backend (`agent/`, `hermes_state_*.py`, …),
  ACP adapter (`acp_adapter/`), gateway (`gateway/`), CLIs (`cli.py`,
  `hermes_cli/`), Electron desktop app (`apps/desktop/`), web UIs
  (`web/`, `ui-tui/`), skills (`skills/`, `optional-skills/`), tools
  (`tools/`), evals (`evals/`), locales (`locales/`), website (`website/`),
  and tests (`tests/`, `tests-js/`).
- **How NEUTRON uses it:**
  - Curated portable skills are copied to `src/server/agent/skills/` and
    wired into the NEUTRON autonomous agent via a `read_skill` tool
    (see `src/server/agent/skills.ts`). Only skills that do not depend on
    Hermes-specific infrastructure (gateway, `hermes` CLI, Hermes-only
    tools) were selected, so the agent never hallucinates capabilities
    it does not have.
  - Everything else is preserved here for browsing, search, and future
    porting. The Python/Electron parts do not execute inside NEUTRON —
    this is stated honestly wherever relevant.

Nothing was removed from the NEUTRON app to add this; all changes are
additive.
