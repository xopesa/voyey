import { createHash } from "node:crypto";
import { infrastructureIsolated } from "./isolation.js";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
export interface AccessConfig {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_ACCESS_EMAILS?: string;
}
export interface AccessIdentity {
  principalHash: string;
}
const keys = new Map<string, JWTVerifyGetKey>();
export function accessConfiguration(config: AccessConfig) {
  if (!infrastructureIsolated(config))
    throw new Error("STENZO Access identity is forbidden in VOYEY");
  const issuer = config.ACCESS_TEAM_DOMAIN ?? "";
  if (
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(
      issuer,
    )
  )
    throw new Error("Access team domain is missing or invalid");
  const audience =
    config.ACCESS_AUD?.split(",")
      .map((x) => x.trim())
      .filter(Boolean) ?? [];
  if (!audience.length || audience.some((x) => !/^[a-f0-9]{64}$/i.test(x)))
    throw new Error("Access application audience is missing or invalid");
  const emails = new Set(
    (config.ADMIN_ACCESS_EMAILS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!emails.size || [...emails].some((x) => !/^\S+@\S+\.\S+$/.test(x)))
    throw new Error("Admin Access email allowlist is missing or invalid");
  return { issuer, audience, emails };
}
export function checkAccessClaims(
  claims: JWTPayload,
  emails: ReadonlySet<string>,
): AccessIdentity {
  if (
    claims.type !== "app" ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.email !== "string" ||
    !emails.has(claims.email.toLowerCase())
  )
    throw new Error("Access identity is not authorized");
  return {
    principalHash: createHash("sha256")
      .update(`${claims.iss}:${claims.sub}:${claims.email.toLowerCase()}`)
      .digest("hex"),
  };
}
export async function authenticateAccess(
  request: Request,
  config: AccessConfig,
): Promise<AccessIdentity> {
  const { issuer, audience, emails } = accessConfiguration(config);
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || token.length > 16384)
    throw new Error("Access assertion required");
  let key = keys.get(issuer);
  if (!key) {
    key = createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"), {
      timeoutDuration: 5000,
      cacheMaxAge: 600000,
    });
    keys.set(issuer, key);
  }
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "email", "type"],
    maxTokenAge: "24h",
    clockTolerance: 5,
  });
  return checkAccessClaims(payload, emails);
}
