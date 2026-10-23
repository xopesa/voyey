import { atomic, prisma } from "@stenzo/database";
import { JwtTokenService } from "../auth/token.js";
import { HttpError } from "../auth/errors.js";
import { validTelegramAdminId } from "@stenzo/shared";

/** Server-only configuration. No default identity and no shared web-admin impersonation. */
export class VoyeyOwnerAuthority {
  constructor(
    private readonly tokens: JwtTokenService,
    private readonly configuredId: () => string = () =>
      process.env.VOYEY_OWNER_TELEGRAM_ID ?? "",
  ) {}
  async authorize(
    authorization: string | undefined,
    action: "PAYMENT_CONFIRM" | "CARGO_CHANGE" | "REFUND_CONFIRM",
  ) {
    let userId: string | null = null;
    try {
      if (authorization?.startsWith("Bearer "))
        userId = await this.tokens.verify(authorization.slice(7));
    } catch {
      /* no token data in audit */
    }
    const outcome = await atomic(async (b) => {
      const configured = this.configuredId();
      const user = userId
        ? await prisma.user.findUnique({ where: { id: userId } })
        : null;
      const admin = user
        ? await prisma.telegramAdmin.findUnique({
            where: { telegramId: user.telegramId.toString() },
          })
        : null;
      const reason = !validTelegramAdminId(configured)
        ? "OWNER_NOT_CONFIGURED"
        : !user || user.status !== "ACTIVE"
          ? "AUTH_REQUIRED"
          : !admin?.isActive
            ? "ACTIVE_ADMIN_REQUIRED"
            : user.telegramId.toString() !== configured
              ? "NOT_OWNER"
              : "AUTHORIZED";
      b.insert("AuditLog", {
        actorId: user?.id ?? null,
        action: reason === "AUTHORIZED" ? "owner.authorized" : "owner.denied",
        entityType: "OwnerAuthority",
        entityId: "voyey-owner",
        metadata: { action, reason },
      });
      return { reason, userId: user?.id };
    });
    if (outcome.reason !== "AUTHORIZED")
      throw new HttpError(
        outcome.reason === "OWNER_NOT_CONFIGURED" ? 503 : 403,
        "Owner authorization denied",
      );
    return { userId: outcome.userId! };
  }
  async confirmNewPayment(authorization: string | undefined) {
    await this.authorize(authorization, "PAYMENT_CONFIRM");
    throw new HttpError(
      503,
      "New payment confirmation remains disabled until 2.4C",
    );
  }
}
