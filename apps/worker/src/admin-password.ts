import { createHash, timingSafeEqual } from "node:crypto";

export interface AdminPasswordEnv {
  ADMIN_AUTH_MODE?: string;
  ADMIN_PANEL_LOGIN?: string;
  ADMIN_PANEL_PASSWORD_HASH?: string;
}

export function adminAuthenticationMode(env: AdminPasswordEnv) {
  const mode = env.ADMIN_AUTH_MODE ?? "access";
  if (mode !== "access" && mode !== "password")
    throw new Error("Invalid Admin authentication mode");
  if (mode === "password" && !adminPasswordConfiguration(env))
    throw new Error("Direct Admin login requires password configuration");
  return mode;
}

export function adminPasswordConfiguration(env: AdminPasswordEnv) {
  if (
    env.ADMIN_PANEL_LOGIN === undefined &&
    env.ADMIN_PANEL_PASSWORD_HASH === undefined
  )
    return undefined;
  if (
    !/^[A-Za-z0-9_-]{3,100}$/.test(env.ADMIN_PANEL_LOGIN ?? "") ||
    !/^pbkdf2-sha256\$600000\$[a-f0-9]{64}\$[a-f0-9]{64}$/.test(
      env.ADMIN_PANEL_PASSWORD_HASH ?? "",
    )
  )
    throw new Error("Admin password configuration is incomplete");
  return {
    login: env.ADMIN_PANEL_LOGIN!,
    hash: env.ADMIN_PANEL_PASSWORD_HASH!,
  };
}

// The browser stretches
// the password with standard PBKDF2; the Worker stores only SHA-256(derived key),
// keeping expensive KDF work outside the Workers Free request CPU budget.
export function verifyAdminPasswordProof(
  config: { login: string; hash: string },
  login: string,
  proof: string,
) {
  if (!/^[a-f0-9]{64}$/.test(proof)) return false;
  const expected = config.hash.split("$")[3]!;
  const actual = createHash("sha256")
    .update(Buffer.from(proof, "hex"))
    .digest();
  const passwordMatches = timingSafeEqual(actual, Buffer.from(expected, "hex"));
  const loginMatches = timingSafeEqual(
    createHash("sha256").update(login).digest(),
    createHash("sha256").update(config.login).digest(),
  );
  return passwordMatches && loginMatches;
}

export function passwordPrincipal(
  accessPrincipal: string,
  config: { login: string; hash: string } | undefined,
) {
  return config
    ? createHash("sha256")
        .update(JSON.stringify([accessPrincipal, config.login, config.hash]))
        .digest("hex")
    : accessPrincipal;
}
