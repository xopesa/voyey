import { ADMIN_LOGIN, WEB_ADMIN_ACTOR } from "./web-session.js";

// Web admin is a separate principal, not a Telegram User or a fabricated FK.
export function adminAuditActor(actorId: string) {
  return actorId === WEB_ADMIN_ACTOR
    ? {
        actorId: null,
        metadata: { adminPrincipal: ADMIN_LOGIN, authType: "web-admin" },
      }
    : { actorId, metadata: {} };
}
