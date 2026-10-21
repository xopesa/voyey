const { spawn } = require("node:child_process");
const { isAbsolute, join, resolve } = require("node:path");

const ports = { api: "10009", admin: "10010", miniapp: "10011" };

function start(app, root) {
  if (!Object.hasOwn(ports, app)) throw new Error("Unknown STENZO application");
  if (!root || !isAbsolute(root))
    throw new Error("STENZO_ROOT must be an absolute monorepo path");
  const port = process.env.PORT || ports[app];
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("PORT must be an integer between 1 and 65535");

  const envFile = resolve(root, process.env.ENV_FILE || ".env");
  const cwd = app === "api" ? root : join(root, "apps", app);
  const entry =
    app === "api"
      ? join(root, "apps", "api", "dist", "server.js")
      : join(cwd, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(
    process.execPath,
    [
      `--env-file=${envFile}`,
      entry,
      ...(app === "api"
        ? []
        : ["start", "--port", port, "--hostname", "127.0.0.1"]),
    ],
    {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: port,
        INSTANCE_HOST: "127.0.0.1",
      },
      stdio: "inherit",
    },
  );

  const handlers = new Map(
    ["SIGTERM", "SIGINT"].map((signal) => [
      signal,
      () => {
        if (!child.killed) child.kill(signal);
      },
    ]),
  );
  for (const [signal, handler] of handlers) process.once(signal, handler);
  const cleanup = () => {
    for (const [signal, handler] of handlers)
      process.removeListener(signal, handler);
  };
  child.once("error", () => {
    cleanup();
    console.error(`Unable to start STENZO ${app}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    cleanup();
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

module.exports = { start };
