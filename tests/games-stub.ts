/**
 * Test stub for the NEUTRON Games modules: sets the minimal NeutronGames
 * surface on globalThis BEFORE the game files are imported, so their
 * `if (!NG) return` guard passes in node and module.exports is populated.
 * Game registrations are collected on globalThis.__gameRegs.
 */
const noop = () => {};
function fakeEl() {
  return {
    appendChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    classList: { add: noop, remove: noop, toggle: noop },
    style: {},
    dataset: {},
    children: [],
  };
}
(globalThis as any).__gameRegs = [];
(globalThis as any).NeutronGames = {
  reg: (d: any) => (globalThis as any).__gameRegs.push(d),
  api: () => ({
    el: () => fakeEl(),
    on: () => noop,
    theme: () => ({}),
    canvas: () => ({ cv: fakeEl(), ctx: {}, W: 0, H: 0, resize: noop }),
    loop: () => noop,
    keys: () => ({ isDown: () => false, pressed: () => false, clearPressed: noop, detach: noop }),
    beep: noop,
    overlay: () => noop,
    status: () => ({ set: noop }),
    host: () => ({ close: noop }),
    join: () => ({ close: noop }),
  }),
  renderGames: noop,
  openGame: noop,
  teardown: noop,
};
export {};
