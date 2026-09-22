import { describe, it, expect, vi } from "vitest";
import { testCommand } from "../src/cli/review-test-commands";

describe("testCommand --watch", () => {
  it("invokes the watch path with the test runner command when watch is set", async () => {
    const watchImpl = vi.fn();
    await testCommand("/tmp/neutron-test-watch", { watch: true }, { watchImpl });
    expect(watchImpl).toHaveBeenCalledTimes(1);
    expect(watchImpl).toHaveBeenCalledWith("/tmp/neutron-test-watch", ["npm", "test", "--", "--run"]);
  });

  it("does not invoke the watch path without the watch flag", async () => {
    const watchImpl = vi.fn();
    await testCommand("/tmp/neutron-test-watch-nope", {}, { watchImpl });
    expect(watchImpl).not.toHaveBeenCalled();
  });
});
