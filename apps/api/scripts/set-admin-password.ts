import { readFile, writeFile } from "node:fs/promises";
import { emitKeypressEvents, type Key } from "node:readline";
import { fileURLToPath } from "node:url";
import { argon2id, hash } from "argon2";

async function hiddenInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Run in an interactive terminal");
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.off("keypress", handler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const handler = (text: string | undefined, key: Key) => {
      if (key.ctrl && key.name === "c") {
        finish();
        reject(new Error("Cancelled"));
      } else if (key.name === "return") {
        finish();
        resolve(value);
      } else if (key.name === "backspace")
        value = [...value].slice(0, -1).join("");
      else if (
        text &&
        !key.ctrl &&
        !key.meta &&
        [...text].every(
          (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
        )
      )
        value += text;
    };
    process.stdin.on("keypress", handler);
  });
}

try {
  const password = await hiddenInput("New admin password (hidden): ");
  if (password.length < 12 || password.length > 1024)
    throw new Error("Use 12–1024 characters");
  if (password !== (await hiddenInput("Confirm password (hidden): ")))
    throw new Error("Passwords do not match");
  const passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new Error("Cannot read local env");
  }
  content = content.replace(/^\s*ADMIN_PASSWORD_HASH\s*=.*(?:\r?\n|$)/gm, "");
  await writeFile(
    envPath,
    `${content.trimEnd()}\nADMIN_PASSWORD_HASH='${passwordHash}'\n`,
    { mode: 0o600 },
  );
  process.stdout.write(
    "Admin password hash saved to local .env. Restart the API.\n",
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Password setup failed"}\n`,
  );
  process.exitCode = 1;
}
