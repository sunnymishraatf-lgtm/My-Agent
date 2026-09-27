# bob_sessions/

Real IBM Bob 2.0 task-session evidence for the NEUTRON hackathon submission.

## What goes here

**Only real screenshots from actual IBM Bob IDE task sessions** performed on
the NEUTRON repository. Each team member who works with Bob in the IDE
captures their task-session summary and drops it into this folder.

## What counts as valid evidence

- A screenshot taken inside **IBM Bob IDE** — never generated, never mocked.
- The session must show a **real task performed on the NEUTRON repo**
  (e.g. repository analysis, impact-analysis review, testing review — see
  `../docs/BOB_TASKS.md` for the recommended task list).
- PNG is preferred so text stays readable.

## Naming format

```
team_task01_repository_analysis.png
team_task02_impact_analysis.png
team_task03_agent_workflow.png
team_task04_testing.png
team_task05_security.png
team_task06_final_review.png
```

Number files in the order the tasks were performed (`team_taskNN_short_description.png`).
If you complete more than six tasks, continue the sequence (`team_task07_...`).

## What does NOT go here

- AI-generated or mocked screenshots. **Do not fabricate.**
- Screenshots of unrelated projects or stock images.
- Sessions that did not actually happen — do not claim work that was
  not done in Bob IDE.

## How to capture a screenshot from Bob IDE (manual)

1. Open the NEUTRON repository in IBM Bob IDE.
2. Start a task with one of the prompts in `docs/BOB_TASKS.md`.
3. Let Bob finish, then open the **task panel** and read the **task summary**
   (the overview Bob writes of what it analyzed / changed / concluded).
4. Take a screenshot showing the task title, the summary, and (where
   relevant) the key output Bob produced. On Windows use `Win + Shift + S`;
   on macOS use `Cmd + Shift + 4`. Save as PNG.
5. Rename the file to the naming format above and place it in this folder.
6. Do **not** edit the screenshot contents — cropping is fine, altering text
   is fabrication.

## Current status

This folder is **intentionally empty**. There are currently no recorded
IBM Bob 2.0 sessions for NEUTRON. It will be populated manually after
team members complete real Bob IDE tasks.

> MANUAL ACTION REQUIRED: perform the recommended tasks in `docs/BOB_TASKS.md`
> inside IBM Bob IDE, save each session-summary screenshot as PNG using the
> naming format above, and place the files in this folder.

## How NEUTRON consumes this evidence

`src/neutron/bob.ts` reads `.agent/bob/` (session exports, if any);
`neutron maintain report --bob` and the web dashboard's Bob view render
real evidence when present and honestly report "no evidence found" when
absent. IBM Bob 2.0 is **not** NEUTRON's runtime AI backend — it is the
development tool used to analyze, review, and improve NEUTRON itself.
