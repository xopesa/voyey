import { atomic, prisma, type Batch } from "@stenzo/database";
import { JwtTokenService } from "../auth/token.js";
import { HttpError } from "../auth/errors.js";
import { validTelegramAdminId } from "@stenzo/shared";

type OwnerAction =
  | "PAYMENT_CONFIRM"
  | "PAYMENT_REJECT"
  | "PAYMENT_PROOF_READ"
  | "PAYMENT_READ"
  | "CARGO_CHANGE"
  | "PREORDER_ARRIVAL"
  | "FINAL_INVOICE"
  | "ORDER_CANCEL"
  | "REFUND_REQUEST"
  | "REFUND_READ"
  | "REFUND_STOCK_RECONCILE"
  | "REFUND_CONFIRM";

/** Server-only configuration. No default identity and no shared web-admin impersonation. */
export class VoyeyOwnerAuthority {
  constructor(
    private readonly tokens: JwtTokenService,
    private readonly configuredId: () => string = () =>
      process.env.VOYEY_OWNER_TELEGRAM_ID ?? "",
  ) {}
  async identify(authorization: string | undefined): Promise<string | null> {
    let userId: string | null = null;
    try {
      if (authorization?.startsWith("Bearer "))
        userId = await this.tokens.verify(authorization.slice(7));
    } catch {
      /* no token data in audit */
    }
    return userId;
  }
  /** Called inside the SAME atomic callback as the financial writer on every CAS retry.
   * Return a denial rather than throwing here so its audit can commit without money writes. */
  async inspect(b: Batch, userId: string | null, action: OwnerAction) {
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
  }
  require(outcome: Awaited<ReturnType<VoyeyOwnerAuthority["inspect"]>>) {
    if (outcome.reason !== "AUTHORIZED")
      throw new HttpError(
        outcome.reason === "OWNER_NOT_CONFIGURED" ? 503 : 403,
        "Owner authorization denied",
      );
    return { userId: outcome.userId! };
  }
  async authorize(authorization: string | undefined, action: OwnerAction) {
    const userId = await this.identify(authorization);
    return this.require(await atomic((b) => this.inspect(b, userId, action)));
  }
  async confirmNewPayment(authorization: string | undefined) {
    await this.authorize(authorization, "PAYMENT_CONFIRM");
    throw new HttpError(
      503,
      "New payment confirmation remains disabled until 2.4C",
    );
  }
}
