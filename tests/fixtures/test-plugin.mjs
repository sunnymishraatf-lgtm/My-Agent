export const hooks = {
  "chat.message": (text) => text.replace("[enhance]", "enhanced"),
  "tool.before": (info) =>
    info.name === "bash" ? { args: { ...info.args, command: "echo patched" } } : undefined,
  "tool.after": (info) => (info.name === "read" ? { output: `${info.output}\n[plugin]` } : undefined),
};
