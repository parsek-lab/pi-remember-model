import type {
  ExtensionAPI,
  ThinkingLevel,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

import { join } from "node:path";

interface SavedConfig {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
}

const THINKING_LEVELS = new Set<unknown>([
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
]);

function isSavedConfig(value: unknown): value is SavedConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return typeof config.provider === "string" && config.provider.trim().length > 0 &&
    typeof config.model === "string" && config.model.trim().length > 0 &&
    THINKING_LEVELS.has(config.thinkingLevel);
}

/**
 * True when the user selected a model explicitly on the command line
 * (`--model`, `--provider`, or `--models`). Pi exposes no event field for this,
 * so the process arguments are the only reliable source. The `argv` parameter
 * exists so callers can inject arguments; it defaults to the live process.
 */
function hasExplicitModelArg(
  argv: readonly string[] = process.argv,
): boolean {
  const args = argv.slice(2);
  const separator = args.indexOf("--");
  return (separator < 0 ? args : args.slice(0, separator)).some(
    (arg) => /^(--model|--provider|--models)(=|$)/.test(arg),
  );
}

export default function rememberModelAndThinking(pi: ExtensionAPI) {
  if (process.env.PI_REMEMBER_MODEL_DISABLE === "1") return;

  const stateFile = join(getAgentDir(), "last-model.json");

  let lastConfig: SavedConfig | undefined;
  let restoring = false;

  function save() {
    if (!lastConfig) return;

    try {
      writeFileSync(
        stateFile,
        JSON.stringify(lastConfig, null, 2) + "\n",
        "utf-8",
      );
    } catch {
      // non bloccare Pi
    }
  }

  if (existsSync(stateFile)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(stateFile, "utf-8"));
      if (isSavedConfig(parsed)) lastConfig = parsed;
    } catch {
      // ignora stato non valido
    }
  }

  pi.on("model_select", async (event, ctx) => {
    if (ctx.mode !== "tui" || restoring || event.source === "restore") {
      return;
    }

    lastConfig = {
      provider: event.model.provider,
      model: event.model.id,
      thinkingLevel: pi.getThinkingLevel(),
    };

    save();
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    if (ctx.mode !== "tui" || restoring || !lastConfig) {
      return;
    }

    lastConfig.thinkingLevel = event.level;
    save();
  });

  pi.on("session_start", async (event, ctx) => {
    // Non-interactive hosts own their model selection. SDK hosts using TUI
    // mode can opt out too; Pi exposes no explicit SDK-model marker here.
    if (ctx.mode !== "tui" || process.env.PI_REMEMBER_MODEL_DISABLE === "1") {
      return;
    }

    if (!lastConfig) {
      return;
    }

    // Apply the saved choice to new sessions, including a fresh startup.
    // Existing, resumed, forked, and reloaded sessions keep their own model.
    const isFreshStartup =
      event.reason === "startup" &&
      !ctx.sessionManager.getEntries().some((entry) => entry.type === "message");

    if (event.reason !== "new" && !isFreshStartup) {
      return;
    }

    // Startup only: CLI model selections win over the remembered choice.
    // A different current model may just be Pi's default, not an explicit
    // selection. An in-process "new" session must still inherit the saved model.
    if (event.reason === "startup" && hasExplicitModelArg()) {
      return;
    }

    const model = ctx.modelRegistry.find(
      lastConfig.provider,
      lastConfig.model,
    );

    if (!model) {
      ctx.ui.notify(
        `Modello non trovato: ${lastConfig.provider}/${lastConfig.model}`,
        "warning",
      );
      return;
    }

    restoring = true;

    try {
      const ok = await pi.setModel(model);

      if (!ok) {
        ctx.ui.notify(
          `Impossibile usare ${lastConfig.provider}/${lastConfig.model}`,
          "warning",
        );
        return;
      }

      pi.setThinkingLevel(lastConfig.thinkingLevel);
    } finally {
      restoring = false;
    }
  });
}