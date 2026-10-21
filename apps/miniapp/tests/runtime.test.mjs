import assert from "node:assert/strict";
import { test } from "node:test";
import { nextRuntime } from "../../../scripts/next-runtime.mjs";
test("ISPmanager PORT overrides defaults without changing local app ports", () => {
  assert.deepEqual(nextRuntime({}, "miniapp"), {
    port: "3000",
    host: "127.0.0.1",
  });
  assert.deepEqual(nextRuntime({}, "admin"), {
    port: "3002",
    host: "127.0.0.1",
  });
  assert.deepEqual(
    nextRuntime({ PORT: "43210", INSTANCE_HOST: "127.0.0.2" }, "admin"),
    { port: "43210", host: "127.0.0.2" },
  );
  for (const PORT of ["0", "65536", "42.5", "bad", "-1"])
    assert.throws(() => nextRuntime({ PORT }, "miniapp"));
});
