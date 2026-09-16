import { render } from "ink";
import { createElement } from "react";
import type { ComponentType } from "react";
import type { TuiAction } from "./types";
import type { ChatRuntime } from "./runtime";

export interface ChatTuiOptions {
  runtime: ChatRuntime;
  startOpts: { model?: string; provider?: string; autoApprove?: boolean; message?: string };
}

export interface TuiController {
  update: (action: TuiAction) => void;
  waitUntilExit: () => Promise<void>;
  destroy: () => void;
}

export async function startChatTui(opts: ChatTuiOptions): Promise<TuiController | null> {
  try {
    const AppComponent = (await import("./App")).App;
    const element = render(createElement(AppComponent as ComponentType<ChatTuiOptions>, opts as never), {
      exitOnCtrlC: false,
    });
    return {
      update(_action: TuiAction): void {
        element.rerender?.(createElement(AppComponent as ComponentType<ChatTuiOptions>, opts as never));
      },
      async waitUntilExit() {
        await element.waitUntilExit();
      },
      destroy() {
        element.unmount();
        opts.runtime.destroy();
      },
    };
  } catch {
    return null;
  }
}