import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { test } from "node:test";
import { URL } from "node:url";
import { runInNewContext } from "node:vm";

const nativeRequire = createRequire(import.meta.url);
const root = resolve("synthetic-checkout");

function launch(app, env = {}) {
  const child = new EventEmitter();
  child.killed = false;
  child.signals = [];
  child.kill = (signal) => {
    child.killed = true;
    child.signals.push(signal);
  };
  const process = new EventEmitter();
  Object.assign(process, {
    env: { STENZO_ROOT: root, ...env },
    execPath: "/synthetic/node",
    pid: 123,
    exit: (code) => {
      process.exitCode = code;
    },
    kill: (pid, signal) => {
      assert.equal(pid, process.pid);
      assert.equal(process.listenerCount(signal), 0);
      process.terminationSignal = signal;
    },
  });
  const spawns = [];
  const errors = [];
  const module = { exports: {} };
  runInNewContext(
    readFileSync(
      new URL("../deploy/turon/launcher.cjs", import.meta.url),
      "utf8",
    ),
    {
      module,
      process,
      console: { error: (message) => errors.push(message) },
      require: (name) =>
        name === "node:child_process"
          ? {
              spawn: (...args) => {
                spawns.push(args);
                return child;
              },
            }
          : nativeRequire(name),
    },
  );
  runInNewContext(
    readFileSync(
      new URL(`../deploy/turon/${app}/server.js`, import.meta.url),
      "utf8",
    ),
    {
      process,
      require: (name) =>
        isAbsolute(name) ? module.exports : nativeRequire(name),
    },
  );
  return { child, process, spawns, errors };
}

for (const [app, port] of [
  ["api", "10009"],
  ["admin", "10010"],
  ["miniapp", "10011"],
]) {
  test(`Turon ${app} uses the shared checkout, private listener and its assigned port`, () => {
    const { spawns } = launch(app, { KEEP_EXISTING_SETTING: "synthetic" });
    assert.equal(spawns.length, 1);
    const [exec, args, options] = spawns[0];
    assert.equal(exec, "/synthetic/node");
    assert.equal(args[0], `--env-file=${join(root, ".env")}`);
    assert.equal(options.cwd, app === "api" ? root : join(root, "apps", app));
    assert.equal(options.env.PORT, port);
    assert.equal(options.env.NODE_ENV, "production");
    assert.equal(options.env.INSTANCE_HOST, "127.0.0.1");
    assert.equal(options.env.KEEP_EXISTING_SETTING, "synthetic");
    assert.equal(options.stdio, "inherit");
    if (app === "api") {
      assert.equal(args[1], join(root, "apps", "api", "dist", "server.js"));
      assert.equal(args.length, 2);
    } else {
      assert.equal(
        args[1],
        join(root, "apps", app, "node_modules", "next", "dist", "bin", "next"),
      );
      assert.deepEqual(Array.from(args.slice(2)), [
        "start",
        "--port",
        port,
        "--hostname",
        "127.0.0.1",
      ]);
    }
    const manifest = JSON.parse(
      readFileSync(
        new URL(`../deploy/turon/${app}/package.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(manifest.scripts.start, "node server.js");
    assert.equal(manifest.type, "commonjs");
    assert.equal(manifest.private, true);
    assert.equal(manifest.engines.node, "24.x");
  });

  test(`Turon ${app} supports explicit port and environment file without loading it`, () => {
    const envFile = resolve("synthetic-private", "runtime.env");
    const { spawns } = launch(app, { PORT: "12000", ENV_FILE: envFile });
    assert.equal(spawns[0][1][0], `--env-file=${envFile}`);
    assert.equal(spawns[0][2].env.PORT, "12000");
    const relative = launch(app, { ENV_FILE: "private/runtime.env" });
    assert.equal(
      relative.spawns[0][1][0],
      `--env-file=${resolve(root, "private/runtime.env")}`,
    );
  });

  for (const signal of ["SIGTERM", "SIGINT"]) {
    test(`Turon ${app} forwards ${signal} and preserves child termination`, () => {
      const { process, child } = launch(app);
      process.emit(signal);
      assert.deepEqual(child.signals, [signal]);
      child.emit("exit", null, signal);
      assert.equal(process.terminationSignal, signal);
      assert.equal(process.listenerCount("SIGTERM"), 0);
      assert.equal(process.listenerCount("SIGINT"), 0);
    });
  }

  test(`Turon ${app} returns the child's exit code and fails on spawn error`, () => {
    for (const code of [0, 17]) {
      const { process, child } = launch(app);
      child.emit("exit", code, null);
      assert.equal(process.exitCode, code);
    }
    const failed = launch(app);
    failed.child.emit("error", new Error("synthetic diagnostics"));
    assert.equal(failed.process.exitCode, 1);
    assert.deepEqual(failed.errors, [`Unable to start STENZO ${app}`]);
    assert.equal(failed.process.listenerCount("SIGTERM"), 0);
    assert.equal(failed.process.listenerCount("SIGINT"), 0);
  });
}

test("Turon launchers reject missing/relative root and invalid ports before spawning", () => {
  for (const value of ["", "relative-checkout"])
    assert.throws(
      () => launch("api", { STENZO_ROOT: value }),
      /STENZO_ROOT must be an absolute monorepo path/,
    );
  for (const PORT of ["0", "65536", "3000x", "-1"])
    assert.throws(() => launch("api", { PORT }), /PORT must be an integer/);
});
