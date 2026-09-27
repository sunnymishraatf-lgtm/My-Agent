import type { StateStore } from "../store";

export function stateCommand(store: StateStore): void {
  const meta = store.getMeta();
  const tasks = store.getTasks();
  console.log("\nAgent / Task Status");
  console.log("-------------------");
  console.log(`Project: ${meta.name || "(unnamed)"}`);
  console.log(`Status: ${meta.status}`);

  const byAgent = new Map<string, number>();
  for (const t of tasks) {
    byAgent.set(t.agent, (byAgent.get(t.agent) ?? 0) + 1);
  }
  if (byAgent.size === 0) {
    console.log("  No tasks yet. Run `neutron plan`.");
    return;
  }
  for (const [agent, count] of byAgent) {
    const done = tasks.filter((t) => t.agent === agent && t.status === "completed").length;
    console.log(`  ${agent}: ${done}/${count} complete`);
  }
}

export function printReview(store: StateStore): void {
  const review = store.getReview();
  if (!review) {
    console.log("No review yet. Run `neutron review`.");
    return;
  }
  console.log(review);
}