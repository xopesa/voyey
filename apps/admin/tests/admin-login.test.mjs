import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomBytes, pbkdf2Sync, webcrypto } from "node:crypto";
import ts from "typescript";
import { createRequire } from "node:module";

const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../src/lib/admin-login.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports, crypto: webcrypto, TextEncoder, Uint8Array },
);
test("browser password stretching matches independent Node PBKDF2; challenge downgrade rejected", async () => {
  const password = randomBytes(24).toString("base64url"),
    salt = randomBytes(32).toString("hex");
  const expected = pbkdf2Sync(
    password,
    Buffer.from(salt, "hex"),
    600000,
    32,
    "sha256",
  ).toString("hex");
  assert.equal(
    await exports.deriveAdminPasswordProof(password, {
      salt,
      iterations: 600000,
    }),
    expected,
  );
  for (const challenge of [
    { salt, iterations: 1 },
    { salt: "invalid", iterations: 600000 },
  ])
    await assert.rejects(() =>
      exports.deriveAdminPasswordProof(password, challenge),
    );
  await assert.rejects(() =>
    exports.deriveAdminPasswordProof("", { salt, iterations: 600000 }),
  );
});

for (const fail of [false, true])
  test(`real Login form sends derived proof only and clears password (${fail ? "failure" : "success"})`, async () => {
    const password = randomBytes(20).toString("base64url");
    const challenge = {
      salt: randomBytes(32).toString("hex"),
      iterations: 600000,
    };
    const state = [false, null, true, "fixture_admin", password, challenge];
    let cursor = 0;
    const calls = [],
      redirects = [],
      updates = [];
    const moduleExports = {};
    const require = createRequire(import.meta.url);
    runInNewContext(
      ts.transpileModule(
        readFileSync(
          new URL("../src/components/Login.tsx", import.meta.url),
          "utf8",
        ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
          },
        },
      ).outputText,
      {
        exports: moduleExports,
        AbortController,
        window: { location: { replace: (path) => redirects.push(path) } },
        require: (name) => {
          if (name === "react")
            return {
              useEffect() {},
              useState: () => {
                const index = cursor++;
                return [
                  state[index],
                  (value) => updates.push({ index, value }),
                ];
              },
            };
          if (name === "react/jsx-runtime") return require(name);
          if (name === "./Header") return { Header: () => null };
          if (name === "./Preferences")
            return {
              usePreferences: () => ({ locale: "ru", t: (key) => key }),
            };
          if (name === "../lib/admin-login") return exports;
          if (name === "../lib/api")
            return {
              api: async (...args) => {
                calls.push(args);
                if (fail) throw new Error("fixture failure");
                return {};
              },
              errorKey: () => "credentials",
            };
          throw new Error("Unexpected import " + name);
        },
      },
    );
    function find(node, type) {
      if (!node || typeof node !== "object") return null;
      if (node.type === type) return node;
      for (const child of [node.props?.children].flat(Infinity)) {
        const hit = find(child, type);
        if (hit) return hit;
      }
      return null;
    }
    const form = find(moduleExports.Login(), "form");
    assert.ok(form);
    assert.equal(find(form, "input").props.autoComplete, "username");
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "auth/login");
    const payload = JSON.parse(calls[0][1].body);
    assert.deepEqual(Object.keys(payload).sort(), ["login", "passwordProof"]);
    assert.equal(
      payload.passwordProof,
      pbkdf2Sync(
        password,
        Buffer.from(challenge.salt, "hex"),
        600000,
        32,
        "sha256",
      ).toString("hex"),
    );
    assert.ok(
      updates.some((update) => update.index === 4 && update.value === ""),
    );
    assert.deepEqual(redirects, fail ? [] : ["/admin/"]);
  });
