// Portable unit tests: native TypeScript stripping, mocked host, no dependencies.
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

const originalArgv = process.argv;
const originalEnv = { ...process.env };
const dirs = [];
let extension;
before(async () => {
  const stub = "data:text/javascript," + encodeURIComponent(
    "export function getAgentDir() { return process.env.PI_CODING_AGENT_DIR; }",
  );
  const hook = `export function resolve(s, c, next) {
    return next(s === '@earendil-works/pi-coding-agent' ? ${JSON.stringify(stub)} : s, c);
  }`;
  register("data:text/javascript;base64," + Buffer.from(hook).toString("base64"));
  extension = (await import("../extensions/remember-model.ts")).default;
});
afterEach(() => {
  process.argv = originalArgv;
  for (const key of ["PI_CODING_AGENT_DIR", "PI_REMEMBER_MODEL_DISABLE"]) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const saved = { provider: "example", model: "remembered", thinkingLevel: "high" };
const remembered = { provider: saved.provider, id: saved.model };
function setup({ state = saved, raw, argv = [], mode = "tui", entries = [], available = true, success = true, disabled = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-remember-model-"));
  dirs.push(dir);
  const file = join(dir, "last-model.json");
  if (raw !== undefined) writeFileSync(file, raw);
  else if (state !== null) writeFileSync(file, JSON.stringify(state));
  process.env.PI_CODING_AGENT_DIR = dir;
  if (disabled) process.env.PI_REMEMBER_MODEL_DISABLE = "1";
  else delete process.env.PI_REMEMBER_MODEL_DISABLE;
  process.argv = ["node", "pi", ...argv];
  const handlers = {};
  const models = [], thinking = [], notifications = [];
  let currentThinking = "medium";
  const pi = {
    on: (name, handler) => { handlers[name] = handler; },
    getThinkingLevel: () => currentThinking,
    setThinkingLevel: (level) => { thinking.push(level); currentThinking = level; },
    setModel: async (model) => { models.push(model); return success; },
  };
  const ctx = {
    mode,
    model: { provider: "other", id: "default" },
    sessionManager: { getEntries: () => entries },
    modelRegistry: { find: () => available ? remembered : undefined },
    ui: { notify: (...args) => notifications.push(args) },
  };
  extension(pi);
  return { file, handlers, models, thinking, notifications, ctx, pi,
    start: (reason = "startup") => handlers.session_start?.({ reason }, ctx),
  };
}

test("plain startup restores saved model over a different default", async () => {
  const s = setup();
  await s.start();
  assert.deepEqual(s.models, [remembered]);
  assert.deepEqual(s.thinking, ["high"]);
});
test("plain startup restores thinking even when model already matches", async () => {
  const s = setup(); s.ctx.model = remembered;
  await s.start();
  assert.deepEqual(s.thinking, ["high"]);
});
for (const flag of ["--model", "--provider", "--models"]) {
  for (const argv of [[flag, "example/remembered"], [`${flag}=example/remembered`]]) {
    test(`explicit ${argv.join(" ")} preserves model and thinking`, async () => {
      const s = setup({ argv });
      s.ctx.model = remembered;
      await s.start();
      assert.deepEqual(s.models, []);
      assert.deepEqual(s.thinking, []);
    });
  }
}
test("arguments after -- are not model selection flags", async () => {
  const s = setup({ argv: ["--", "--model"] });
  await s.start(); assert.equal(s.models.length, 1);
});
for (const reason of ["resume", "fork", "reload"]) {
  test(`${reason} leaves session untouched`, async () => {
    const s = setup(); await s.start(reason);
    assert.deepEqual(s.models, []); assert.deepEqual(s.thinking, []);
  });
}
test("startup with existing messages leaves session untouched", async () => {
  const s = setup({ entries: [{ type: "message" }] });
  await s.start(); assert.deepEqual(s.models, []);
});
test("new session inherits saved choice despite original CLI flags", async () => {
  const s = setup({ argv: ["--model", "other/default"] });
  await s.start("new"); assert.deepEqual(s.models, [remembered]);
});
for (const state of [null, {}, [], "bad", 123, { ...saved, provider: " " },
  { ...saved, model: 123 }, { ...saved, model: "" },
  { ...saved, thinkingLevel: "invalid" }, { provider: "a", model: "b" }]) {
  test(`missing or invalid state ignored: ${JSON.stringify(state)}`, async () => {
    const s = setup({ state }); await s.start();
    assert.deepEqual(s.models, []); assert.deepEqual(s.thinking, []);
  });
}
for (const raw of ["{broken", "null"]) {
  test(`invalid JSON state ignored: ${raw}`, async () => {
    const s = setup({ raw }); await s.start(); assert.deepEqual(s.models, []);
  });
}
for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
  test(`valid thinking level ${level} restored`, async () => {
    const s = setup({ state: { ...saved, thinkingLevel: level } });
    await s.start(); assert.deepEqual(s.thinking, [level]);
  });
}
for (const options of [{ available: false }, { success: false }]) {
  test(`unavailable model warns safely: ${JSON.stringify(options)}`, async () => {
    const s = setup(options); await s.start();
    assert.equal(s.notifications.length, 1);
    assert.equal(s.notifications[0][1], "warning");
    assert.deepEqual(s.thinking, []);
  });
}
for (const mode of ["rpc", "json", "print"]) {
  test(`${mode} host retains model and does not alter global state`, async () => {
    const s = setup({ mode }); const original = readFileSync(s.file, "utf8");
    await s.start(); await s.start("new");
    await s.handlers.model_select({ model: remembered, source: "set" }, s.ctx);
    await s.handlers.thinking_level_select({ level: "max" }, s.ctx);
    assert.deepEqual(s.models, []); assert.deepEqual(s.thinking, []);
    assert.equal(readFileSync(s.file, "utf8"), original);
  });
}
test("SDK/TUI opt-out disables all handlers", async () => {
  const s = setup({ disabled: true }); await s.start();
  assert.deepEqual(s.handlers, {}); assert.deepEqual(s.models, []);
});
test("model selection saves provider, ID and current thinking", async () => {
  const s = setup({ state: null });
  await s.handlers.model_select({ model: remembered, source: "set" }, s.ctx);
  assert.deepEqual(JSON.parse(readFileSync(s.file)), { ...saved, thinkingLevel: "medium" });
});
test("thinking selection updates saved config", async () => {
  const s = setup();
  await s.handlers.thinking_level_select({ level: "max" }, s.ctx);
  assert.deepEqual(JSON.parse(readFileSync(s.file)), { ...saved, thinkingLevel: "max" });
});
test("thinking selection without known model does not create state", async () => {
  const s = setup({ state: null });
  await s.handlers.thinking_level_select({ level: "max" }, s.ctx);
  assert.equal(existsSync(s.file), false);
});
test("restoration does not overwrite saved state through emitted events", async () => {
  const s = setup(); const original = readFileSync(s.file, "utf8");
  s.pi.setModel = async (model) => {
    await s.handlers.model_select({ model, source: "set" }, s.ctx);
    await s.handlers.thinking_level_select({ level: "off" }, s.ctx);
    return true;
  };
  await s.start(); assert.equal(readFileSync(s.file, "utf8"), original);
});
