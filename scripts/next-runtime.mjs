/* global process, console */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

export function nextRuntime(env, app) {
  if (!["miniapp", "admin"].includes(app)) throw new Error("Unknown Next app");
  const value = env.PORT || (app === "admin" ? "3002" : "3000");
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    throw new Error("PORT must be an integer between 1 and 65535");
  return { port: value, host: env.INSTANCE_HOST || "127.0.0.1" };
}

export function startNext(app) {
  const { port, host } = nextRuntime(process.env, app);
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const child = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "start",
      "--port",
      port,
      "--hostname",
      host,
    ],
    { stdio: "inherit", env: process.env },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => child.kill(signal));
  child.once("error", () => {
    console.error("Unable to start Next.js");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 0 : 1);
  });
}
