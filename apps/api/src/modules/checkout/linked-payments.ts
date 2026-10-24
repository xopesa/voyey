import { createHash, randomUUID } from "node:crypto";
import { atomic, database, prisma } from "@stenzo/database";
import { z } from "zod";
import { VoyeyOwnerAuthority } from "../admin/owner.js";
import { HttpError } from "../auth/errors.js";
import { D1MediaBucket } from "../../d1/media.js";
import {
  validateImageUpload,
  imageExtensionByMimeType,
} from "../media/image-validation.js";
import { idempotencyKeySchema } from "../orders/schemas.js";
import type { ManualPaymentConfig } from "../payments/service.js";
import {
  readOrderFinance,
  assertCheckoutOpen,
  type CheckoutFinancialState,
} from "./payment-state.js";
import type { FinalInvoiceRow } from "./preorder-finance.js";
import { assertFirstSubmission, readFirstWindow } from "./first-window.js";

const amount = z.number().int().min(1).max(2147483647);
const claimSchema = z.object({ declaredAmount: amount }).strict();
const reviewSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("APPROVE"),
      confirmedAmount: amount,
      // Owner must transcribe the SAME canonical bank transaction reference on every review.
      // Only its domain-separated digest is persisted. A receipt hash is never a bank identity.
      bankOperationReference: z
        .string()
        .trim()
        .min(8)
        .max(128)
        .regex(/^[A-Za-z0-9 .:_-]+$/),
    })
    .strict(),
  z
    .object({
      decision: z.literal("REJECT"),
      reason: z.enum([
        "NOT_RECEIVED",
        "UNREADABLE",
        "AMOUNT_MISMATCH",
        "DUPLICATE_TRANSFER",
        "OTHER",
      ]),
    })
    .strict(),
]);
type PaymentRow = Omit<
  Awaited<ReturnType<typeof prisma.checkoutPayment.findUniqueOrThrow>>,
  "submittedAt" | "reviewedAt"
> & { submittedAt: number; reviewedAt: number | null };
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "Invalid linked payment request");
  return result.data;
}
function bankDigest(reference: string) {
  const canonical = reference.replace(/[ .:_-]/g, "").toUpperCase();
  if (canonical.length < 8)
    throw new HttpError(400, "Invalid bank operation reference");
  return hash("VOYEY_BANK_OPERATION_V1:" + canonical);
}

/** No HTTP routes, env enable switch, Telegram calls or external storage writes.
 * One full payment per phase. FINAL requires an immutable PREORDER invoice; fulfillment stays blocked. */
export class LinkedCheckoutPayments {
  private readonly media = new D1MediaBucket(true);
  constructor(
    private readonly owner: VoyeyOwnerAuthority,
    private readonly enabled = false,
    private readonly card?: ManualPaymentConfig,
  ) {}
  private gate() {
    if (!this.enabled)
      throw new HttpError(503, "Linked payments are internal and disabled");
  }
  private async subject(authorization: string | undefined) {
    const id = await this.owner.identify(authorization);
    if (!id) throw new HttpError(401, "Personal VOYEY authentication required");
    return id;
  }
  private async buyer(userId: string, orderId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE")
      throw new HttpError(403, "Customer unavailable");
    const state = await readOrderFinance(orderId);
    if (state.userId !== userId)
      throw new HttpError(404, "Linked order not found");
    return state;
  }
  private async payment(id: string) {
    const p = await database()
      .prepare("SELECT * FROM CheckoutPayment WHERE id=?")
      .bind(id)
      .first<PaymentRow>();
    if (!p) throw new HttpError(404, "Linked payment not found");
    return p;
  }
  private async result(id: string) {
    return atomic(() => this.resultSnapshot(id));
  }
  private async resultSnapshot(id: string) {
    const p = await this.payment(id);
    return {
      payment: {
        id: p.id,
        orderId: p.orderId,
        phase: p.phase,
        ...(p.phase === "FINAL" ? { invoiceId: p.invoiceId } : {}),
        source: p.source,
        status: p.status,
        declaredAmount: p.declaredAmount,
        expectedAmount: p.expectedAmount,
        confirmedAmount: p.confirmedAmount,
        submittedAt: p.submittedAt,
        reviewedAt: p.reviewedAt,
        rejectionReason: p.rejectionReason,
      },
      finance: await readOrderFinance(p.orderId),
    };
  }
  async state(authorization: string | undefined, orderId: string) {
    this.gate();
    const userId = await this.subject(authorization);
    return atomic(async () => {
      const state = await this.buyer(userId, orderId);
      const window = await readFirstWindow(orderId);
      return { ...state, ...(window ? { firstPaymentWindow: window } : {}) };
    });
  }
  async reviewState(authorization: string | undefined, paymentId: string) {
    this.gate();
    const subject = await this.owner.identify(authorization);
    const outcome = await atomic(async (b) => {
      const authority = await this.owner.inspect(b, subject, "PAYMENT_READ");
      if (authority.reason !== "AUTHORIZED")
        return { denied: authority, result: null };
      return { denied: null, result: await this.resultSnapshot(paymentId) };
    });
    if (outcome.denied) this.owner.require(outcome.denied);
    return outcome.result!;
  }
  async instructions(authorization: string | undefined, orderId: string) {
    return this.phaseInstructions(authorization, orderId, "FIRST");
  }
  async finalInstructions(authorization: string | undefined, orderId: string) {
    return this.phaseInstructions(authorization, orderId, "FINAL");
  }
  private async obligation(
    state: CheckoutFinancialState,
    phase: "FIRST" | "FINAL",
  ) {
    assertCheckoutOpen(state);
    if (phase === "FIRST") {
      if (!state.firstPaymentDue)
        throw new HttpError(
          409,
          "First payment already confirmed; subsequent payments disabled",
        );
      return {
        amount: state.firstPaymentDue,
        invoiceId: null,
        goodsAmount: state.firstPaymentDue,
        cargoAmount: 0,
      };
    }
    if (
      state.saleMode !== "PREORDER" ||
      !state.finalInvoiceId ||
      state.finalDue === null ||
      state.finalDue <= 0
    )
      throw new HttpError(
        409,
        "Final payment requires a positive issued PREORDER invoice",
      );
    const invoice = await database()
      .prepare("SELECT * FROM CheckoutFinalInvoice WHERE id=? AND orderId=?")
      .bind(state.finalInvoiceId, state.orderId)
      .first<FinalInvoiceRow>();
    if (!invoice || invoice.totalDue !== state.finalDue)
      throw new HttpError(409, "Final invoice obligation mismatch");
    return {
      amount: invoice.totalDue,
      invoiceId: invoice.id,
      goodsAmount: invoice.goodsDue,
      cargoAmount: invoice.cargoDue,
    };
  }
  private async phaseInstructions(
    authorization: string | undefined,
    orderId: string,
    phase: "FIRST" | "FINAL",
  ) {
    this.gate();
    const subject = await this.subject(authorization);
    const { state, due } = await atomic(async () => {
      const state = await this.buyer(subject, orderId);
      return { state, due: await this.obligation(state, phase) };
    });
    if (!this.card?.cardNumber.trim() || !this.card.cardHolder.trim())
      throw new HttpError(503, "Independent VOYEY card is not configured");
    return {
      orderId,
      publicId: state.publicId,
      phase,
      amount: due.amount,
      currency: "UZS" as const,
      cardNumber: this.card.cardNumber,
      cardHolder: this.card.cardHolder,
      instructionsRu: this.card.instructionsRu,
      instructionsUz: this.card.instructionsUz,
    };
  }
  async submit(
    authorization: string | undefined,
    orderId: string,
    key: string,
    claim: unknown,
    proof: { data: Buffer; declaredMimeType: string },
  ) {
    return this.submitPhase(authorization, orderId, key, claim, proof, "FIRST");
  }
  async submitFinal(
    authorization: string | undefined,
    orderId: string,
    key: string,
    claim: unknown,
    proof: { data: Buffer; declaredMimeType: string },
  ) {
    return this.submitPhase(authorization, orderId, key, claim, proof, "FINAL");
  }
  private async submitPhase(
    authorization: string | undefined,
    orderId: string,
    key: string,
    claim: unknown,
    proof: { data: Buffer; declaredMimeType: string },
    phase: "FIRST" | "FINAL",
  ) {
    this.gate();
    const userId = await this.subject(authorization);
    key = parsed(idempotencyKeySchema, key);
    const data = parsed(claimSchema, claim);
    const mime = validateImageUpload(
      proof.data,
      proof.declaredMimeType,
      5 * 1024 * 1024,
    );
    // Copy before any await so caller mutation cannot invalidate the hash/validation.
    const bytes = Buffer.from(proof.data),
      proofSha256 = hash(bytes);
    const fingerprint = hash(
      JSON.stringify({
        orderId,
        phase,
        source: "WEBSITE",
        declaredAmount: data.declaredAmount,
        mime,
        proofSha256,
      }),
    );
    const id = randomUUID(),
      storageKey = `payment-proofs/${id}.${imageExtensionByMimeType[mime]}`;
    const paymentId = await atomic(async (b) => {
      const state = await this.buyer(userId, orderId);
      assertCheckoutOpen(state);
      const old = await database()
        .prepare(
          "SELECT id,submitFingerprint FROM CheckoutPayment WHERE submittedBy=? AND submitKey=?",
        )
        .bind(userId, key)
        .first<{ id: string; submitFingerprint: string }>();
      if (old) {
        if (old.submitFingerprint !== fingerprint)
          throw new HttpError(409, "Incompatible receipt key reuse");
        return old.id;
      }
      const due = await this.obligation(state, phase);
      if (
        await database()
          .prepare(
            "SELECT id FROM CheckoutPayment WHERE orderId=? AND phase=? AND status='SUBMITTED'",
          )
          .bind(orderId, phase)
          .first()
      )
        throw new HttpError(409, "Receipt already pending review");
      const submittedAt = Date.now();
      if (phase === "FIRST") await assertFirstSubmission(orderId, submittedAt);
      this.media.putInBatch(b, storageKey, bytes, {
        httpMetadata: { contentType: mime },
      });
      const values: unknown[] = [
        id,
        orderId,
        "WEBSITE",
        userId,
        userId,
        key,
        fingerprint,
        data.declaredAmount,
        due.amount,
        storageKey,
        mime,
        bytes.length,
        proofSha256,
        submittedAt,
      ];
      const columns =
        "id,orderId,source,submittedBy,attachedBy,submitKey,submitFingerprint,declaredAmount,expectedAmount,proofStorageKey,proofMimeType,proofSize,proofSha256,submittedAt";
      if (phase === "FINAL") values.push(phase, due.invoiceId);
      b.sql(
        `INSERT INTO CheckoutPayment(${columns}${phase === "FINAL" ? ",phase,invoiceId" : ""}) VALUES(${values.map(() => "?").join(",")})`,
        ...values,
      );
      b.insert("AuditLog", {
        actorId: userId,
        action: "linked-payment.submitted",
        entityType: "CheckoutPayment",
        entityId: id,
        metadata: { orderId, source: "WEBSITE", phase },
      });
      return id;
    });
    return this.result(paymentId);
  }
  async review(
    authorization: string | undefined,
    paymentId: string,
    key: string,
    value: unknown,
  ) {
    this.gate();
    key = parsed(idempotencyKeySchema, key);
    const data = parsed(reviewSchema, value);
    const operationDigest =
      data.decision === "APPROVE"
        ? bankDigest(data.bankOperationReference)
        : null;
    const fingerprint = hash(
      JSON.stringify({
        paymentId,
        decision: data.decision,
        amount: data.decision === "APPROVE" ? data.confirmedAmount : null,
        operationDigest,
        reason: data.decision === "REJECT" ? data.reason : null,
      }),
    );
    const outcome = await atomic(async (b) => {
      const authority = await this.owner.inspect(
        b,
        await this.owner.identify(authorization),
        data.decision === "APPROVE" ? "PAYMENT_CONFIRM" : "PAYMENT_REJECT",
      );
      if (authority.reason !== "AUTHORIZED") return { denied: authority };
      const p = await this.payment(paymentId),
        state = await readOrderFinance(p.orderId);
      assertCheckoutOpen(state);
      if (p.status !== "SUBMITTED") {
        if (
          p.reviewKey !== key ||
          p.reviewFingerprint !== fingerprint ||
          p.reviewedBy !== authority.userId
        )
          throw new HttpError(409, "Incompatible payment review replay");
        return { denied: null };
      }
      if (
        await database()
          .prepare(
            "SELECT id FROM CheckoutPayment WHERE reviewedBy=? AND reviewKey=?",
          )
          .bind(authority.userId, key)
          .first()
      )
        throw new HttpError(409, "Review key already used");
      if (p.phase !== "FIRST" && p.phase !== "FINAL")
        throw new HttpError(409, "Unsupported payment phase");
      const due = await this.obligation(state, p.phase);
      if (
        due.amount !== p.expectedAmount ||
        (p.phase === "FINAL" && due.invoiceId !== p.invoiceId)
      )
        throw new HttpError(409, "Payment obligation changed");
      const now = Math.max(Date.now(), p.submittedAt);
      if (data.decision === "APPROVE") {
        if (
          data.confirmedAmount !== p.expectedAmount ||
          data.confirmedAmount !== due.amount
        )
          throw new HttpError(
            409,
            "Confirm exactly the payment obligation; overpayment/partial payment denied",
          );
        if (
          await database()
            .prepare(
              "SELECT id FROM CheckoutPaymentLedger WHERE bankOperationDigest=?",
            )
            .bind(operationDigest)
            .first()
        )
          throw new HttpError(409, "Bank transfer already credited");
        const values: unknown[] = [
          randomUUID(),
          p.id,
          p.orderId,
          p.phase,
          "MANUAL_CARD_TRANSFER",
          due.goodsAmount,
          operationDigest,
          authority.userId,
          now,
          key,
          fingerprint,
        ];
        const columns =
          "id,paymentId,orderId,phase,kind,goodsAmount,bankOperationDigest,verifiedBy,verifiedAt,reviewKey,reviewFingerprint";
        if (p.phase === "FINAL") values.push(due.cargoAmount, due.invoiceId);
        b.sql(
          `INSERT INTO CheckoutPaymentLedger(${columns}${p.phase === "FINAL" ? ",cargoAmount,invoiceId" : ""}) VALUES(${values.map(() => "?").join(",")})`,
          ...values,
        );
      } else {
        b.sql(
          "UPDATE CheckoutPayment SET status='REJECTED',reviewedBy=?,reviewedAt=?,reviewKey=?,reviewFingerprint=?,rejectionReason=? WHERE id=?",
          authority.userId,
          now,
          key,
          fingerprint,
          data.reason,
          p.id,
        );
      }
      b.insert("AuditLog", {
        actorId: authority.userId,
        action:
          data.decision === "APPROVE"
            ? "linked-payment.approved"
            : "linked-payment.rejected",
        entityType: "CheckoutPayment",
        entityId: p.id,
        metadata: {
          orderId: p.orderId,
          phase: p.phase,
          ...(data.decision === "REJECT" ? { reason: data.reason } : {}),
        },
      });
      return { denied: null };
    });
    if (outcome.denied) this.owner.require(outcome.denied);
    return this.result(paymentId);
  }
  async proof(authorization: string | undefined, paymentId: string) {
    this.gate();
    const subject = await this.subject(authorization);
    const outcome = await atomic(async (b) => {
      const p = await this.payment(paymentId),
        state = await readOrderFinance(p.orderId);
      if (state.userId === subject) await this.buyer(subject, p.orderId);
      else {
        const authority = await this.owner.inspect(
          b,
          subject,
          "PAYMENT_PROOF_READ",
        );
        if (authority.reason !== "AUTHORIZED")
          return { denied: authority, data: null };
      }
      const object = await this.media.get(p.proofStorageKey);
      if (!object) throw new HttpError(503, "Private receipt unavailable");
      return {
        denied: null,
        data: {
          data: Buffer.from(await object.arrayBuffer()),
          mimeType: p.proofMimeType,
        },
      };
    });
    if (outcome.denied) this.owner.require(outcome.denied);
    return outcome.data!;
  }
  attachTelegramProof(): never {
    throw new HttpError(
      503,
      "Operator receipt attachment requires personal staff permissions and remains disabled",
    );
  }
}
