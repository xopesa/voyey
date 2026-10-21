import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { JwtTokenService } from "../src/modules/auth/token.js";
import {
  PrivateImageStorageService,
  type StorageProvider,
  type StorageWriteInput,
} from "../src/modules/media/index.js";
import { OrderNotFoundError } from "../src/modules/orders/errors.js";
import {
  assertAdminStatusTransition,
  submissionPhase,
} from "../src/modules/orders/status-policy.js";
import type {
  OrderRecord,
  OrderStatusValue,
} from "../src/modules/orders/types.js";
import {
  FinalPaymentRequestNotAllowedError,
  PaymentReviewNotAllowedError,
  PaymentSubmissionNotAllowedError,
} from "../src/modules/payments/errors.js";
import {
  type OrderMutationResult,
  type PaymentRepository,
  type ReviewPaymentResult,
  type SubmitPaymentResult,
} from "../src/modules/payments/repository.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import type { NotificationProvider } from "../src/modules/notifications/types.js";
import { registerPaymentRoutes } from "../src/modules/payments/route.js";
import { PaymentService } from "../src/modules/payments/service.js";
import type {
  AdminPaymentRecord,
  PaymentListQuery,
  PaymentListResult,
  PaymentRecord,
  SubmitPaymentInput,
} from "../src/modules/payments/types.js";
import { createTestUserService, testUsers } from "./helpers/auth.js";

const now = new Date("2026-09-29T12:00:00.000Z");
const jwtSecret = "payment-lifecycle-test-secret-at-least-32-characters";

function createOrder(): OrderRecord {
  return {
    id: "order-1",
    publicId: "STZ-ORDER-001",
    userId: "user-1",
    idempotencyKey: "checkout-key",
    status: "AWAITING_PREPAYMENT",
    currency: "UZS",
    subtotal: 101,
    total: 101,
    requiredPrepayment: 51,
    paidAmount: 0,
    remainingAmount: 50,
    cargoAmount: null,
    cargoPaidAmount: 0,
    fullName: "Customer One",
    phone: "+998901234567",
    city: "Tashkent",
    address: "Test street 1",
    apartment: null,
    comment: null,
    createdAt: now,
    updatedAt: now,
    items: [],
    payments: [],
    user: {
      id: "user-1",
      telegramId: 101n,
      username: "customer_one",
      firstName: "Customer",
      lastName: "One",
      languageCode: "ru",
      preferredLocale: "ru",
    },
  };
}

class MemoryPaymentRepository implements PaymentRepository {
  public readonly order = createOrder();
  public readonly payments: PaymentRecord[] = [];
  public readonly audit: Array<{ action: string; from?: string; to?: string }> =
    [];
  private nextPaymentId = 1;

  public getOrderForUser(
    userId: string,
    publicId: string,
  ): Promise<OrderRecord | null> {
    return Promise.resolve(
      this.order.userId === userId && this.order.publicId === publicId
        ? this.order
        : null,
    );
  }

  public findOwnerSubmission(
    userId: string,
    publicId: string,
    idempotencyKey: string,
  ): Promise<PaymentRecord | null> {
    if (this.order.userId !== userId || this.order.publicId !== publicId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      this.payments.find(
        (payment) => payment.idempotencyKey === idempotencyKey,
      ) ?? null,
    );
  }

  public submit(input: SubmitPaymentInput): Promise<SubmitPaymentResult> {
    if (
      this.order.userId !== input.userId ||
      this.order.publicId !== input.orderPublicId
    ) {
      throw new OrderNotFoundError();
    }
    const existing = this.payments.find(
      (payment) => payment.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return Promise.resolve({ payment: existing, created: false });
    const type = submissionPhase(this.order.status);
    if (!type) throw new PaymentSubmissionNotAllowedError();
    const payment: PaymentRecord = {
      id: `payment-${this.nextPaymentId++}`,
      orderId: this.order.id,
      type,
      status: "SUBMITTED",
      expectedAmount:
        type === "PREPAYMENT"
          ? this.order.requiredPrepayment
          : this.order.remainingAmount + (this.order.cargoAmount ?? 0),
      idempotencyKey: input.idempotencyKey,
      proofStorageKey: input.proofStorageKey,
      proofMimeType: input.proofMimeType,
      reviewedByUserId: null,
      rejectionReason: null,
      submittedAt: new Date(now.getTime() + this.nextPaymentId),
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const from = this.order.status;
    this.order.status =
      type === "PREPAYMENT"
        ? "PREPAYMENT_SUBMITTED"
        : "FINAL_PAYMENT_SUBMITTED";
    this.payments.unshift(payment);
    this.syncOrderPayments();
    this.audit.push(
      { action: "payment.submitted" },
      { action: "order.status_changed", from, to: this.order.status },
    );
    return Promise.resolve({ payment, created: true });
  }

  public listForAdmin(query: PaymentListQuery): Promise<PaymentListResult> {
    const filtered = this.payments
      .filter((payment) => !query.status || payment.status === query.status)
      .filter((payment) => !query.type || payment.type === query.type)
      .slice(0, query.limit)
      .map((payment) => this.asAdmin(payment));
    return Promise.resolve({ payments: filtered, nextCursor: null });
  }

  public getForAdmin(id: string): Promise<AdminPaymentRecord | null> {
    const payment = this.payments.find((item) => item.id === id);
    return Promise.resolve(payment ? this.asAdmin(payment) : null);
  }

  public approve(
    id: string,
    adminUserId: string,
  ): Promise<ReviewPaymentResult> {
    return this.review(id, adminUserId, "APPROVED", null);
  }

  public reject(
    id: string,
    adminUserId: string,
    reason: string | null,
  ): Promise<ReviewPaymentResult> {
    return this.review(id, adminUserId, "REJECTED", reason);
  }

  public transitionOrder(
    publicId: string,
    targetStatus: OrderStatusValue,
  ): Promise<OrderMutationResult> {
    if (this.order.publicId !== publicId) throw new OrderNotFoundError();
    if (this.order.status === targetStatus) {
      return Promise.resolve({ order: this.order, changed: false });
    }
    const from = this.order.status;
    assertAdminStatusTransition(from, targetStatus);
    this.order.status = targetStatus;
    this.audit.push({ action: "order.status_changed", from, to: targetStatus });
    if (targetStatus === "COMPLETED") {
      this.audit.push({ action: "order.completed" });
    }
    return Promise.resolve({ order: this.order, changed: true });
  }

  public requestFinalPayment(
    publicId: string,
    cargoAmount: number,
  ): Promise<OrderMutationResult> {
    if (this.order.publicId !== publicId) throw new OrderNotFoundError();
    if (
      this.order.status === "AWAITING_FINAL_PAYMENT" &&
      this.order.cargoAmount === cargoAmount
    ) {
      return Promise.resolve({ order: this.order, changed: false });
    }
    if (this.order.status !== "WEIGHING") {
      throw new FinalPaymentRequestNotAllowedError();
    }
    this.order.cargoAmount = cargoAmount;
    this.order.status = "AWAITING_FINAL_PAYMENT";
    this.audit.push(
      { action: "order.cargo_assigned" },
      { action: "order.final_payment_requested" },
    );
    return Promise.resolve({ order: this.order, changed: true });
  }

  private review(
    id: string,
    adminUserId: string,
    decision: "APPROVED" | "REJECTED",
    reason: string | null,
  ): Promise<ReviewPaymentResult> {
    const payment = this.payments.find((item) => item.id === id);
    if (!payment) throw new PaymentReviewNotAllowedError();
    if (payment.status === decision) {
      return Promise.resolve({
        payment: this.asAdmin(payment),
        changed: false,
      });
    }
    if (payment.status !== "SUBMITTED") {
      throw new PaymentReviewNotAllowedError();
    }
    const requiredStatus =
      payment.type === "PREPAYMENT"
        ? "PREPAYMENT_SUBMITTED"
        : "FINAL_PAYMENT_SUBMITTED";
    if (this.order.status !== requiredStatus) {
      throw new PaymentReviewNotAllowedError();
    }
    const from = this.order.status;
    payment.status = decision;
    payment.reviewedByUserId = adminUserId;
    payment.reviewedAt = now;
    payment.rejectionReason = decision === "REJECTED" ? reason : null;
    if (decision === "REJECTED") {
      this.order.status =
        payment.type === "PREPAYMENT"
          ? "AWAITING_PREPAYMENT"
          : "AWAITING_FINAL_PAYMENT";
    } else if (payment.type === "PREPAYMENT") {
      this.order.status = "AWAITING_PURCHASE";
      this.order.paidAmount = this.order.requiredPrepayment;
    } else {
      this.order.status = "PAID_FULL";
      this.order.paidAmount = this.order.total;
      this.order.remainingAmount = 0;
      this.order.cargoPaidAmount = this.order.cargoAmount ?? 0;
    }
    this.syncOrderPayments();
    this.audit.push(
      {
        action:
          decision === "APPROVED" ? "payment.approved" : "payment.rejected",
      },
      {
        action: "order.status_changed",
        from,
        to: this.order.status,
      },
    );
    return Promise.resolve({
      payment: this.asAdmin(payment),
      changed: true,
    });
  }

  private syncOrderPayments(): void {
    this.order.payments = this.payments.map((payment) => ({
      id: payment.id,
      type: payment.type,
      status: payment.status,
      expectedAmount: payment.expectedAmount,
      submittedAt: payment.submittedAt,
      reviewedAt: payment.reviewedAt,
      rejectionReason: payment.rejectionReason,
    }));
  }

  private asAdmin(payment: PaymentRecord): AdminPaymentRecord {
    const reviewer = testUsers.find(
      (user) => user.id === payment.reviewedByUserId,
    );
    return {
      ...payment,
      order: this.order,
      reviewedBy: reviewer
        ? {
            id: reviewer.id,
            telegramId: reviewer.telegramId,
            username: reviewer.username,
          }
        : null,
    };
  }
}

class MemoryPrivateStorage implements StorageProvider {
  public readonly files = new Map<string, Buffer>();
  public readonly deleted: string[] = [];

  public upload(input: StorageWriteInput): Promise<void> {
    this.files.set(input.key, input.data);
    return Promise.resolve();
  }

  public delete(key: string): Promise<void> {
    this.files.delete(key);
    this.deleted.push(key);
    return Promise.resolve();
  }

  public read(key: string): Promise<Buffer> {
    const file = this.files.get(key);
    return file
      ? Promise.resolve(file)
      : Promise.reject(new Error("Proof not found"));
  }
}

class RecordingNotificationProvider implements NotificationProvider {
  public sendPhoto(
    chatId: string,
    _bytes: Buffer,
    _mime: string,
    caption: string,
  ): Promise<void> {
    this.messages.push({ chatId, text: caption });
    return Promise.resolve();
  }
  public readonly messages: Array<{ chatId: string; text: string }> = [];

  public sendText(chatId: string, text: string): Promise<void> {
    this.messages.push({ chatId, text });
    return Promise.resolve();
  }
}

async function createFixture() {
  const app = Fastify();
  app.decorateRequest("currentUser", null);
  const repository = new MemoryPaymentRepository();
  const storage = new MemoryPrivateStorage();
  const notificationProvider = new RecordingNotificationProvider();
  const notifications = new NotificationService(
    notificationProvider,
    new Set(["42"]),
    { error() {} },
    { adminOrigin: "https://admin.fixture.invalid" },
  );
  let fileId = 0;
  const service = new PaymentService(
    repository,
    new PrivateImageStorageService(
      storage,
      1024,
      () => `00000000-0000-4000-8000-${String(++fileId).padStart(12, "0")}`,
    ),
    {
      cardNumber: "8600 0000 0000 0000",
      cardHolder: "STENZO WEAR",
      instructionsRu: "Переведите точную сумму",
      instructionsUz: "Aniq summani o'tkazing",
      maxProofUploadSize: 1024,
    },
    notifications,
  );
  const tokenService = new JwtTokenService(jwtSecret);
  const userService = createTestUserService();
  registerPaymentRoutes(
    app,
    service,
    tokenService,
    userService,
    tokenService,
    userService,
    new Set(["42"]),
    1024,
  );
  return {
    app,
    repository,
    service,
    storage,
    notificationProvider,
    customerToken: await tokenService.issue("user-1"),
    otherCustomerToken: await tokenService.issue("user-2"),
    adminToken: await tokenService.issue("admin"),
  };
}

function multipartProof(data: Buffer, mimetype: string) {
  const boundary = "stenzo-payment-test-boundary";
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.bin"\r\nContent-Type: ${mimetype}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

import { png } from "./fixtures/images.js";

async function submitPrepayment(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  key = "prepayment-attempt-1",
) {
  const file = multipartProof(png, "image/png");
  return fixture.app.inject({
    method: "POST",
    url: "/orders/STZ-ORDER-001/payments?amount=1",
    headers: {
      authorization: `Bearer ${fixture.customerToken}`,
      "idempotency-key": key,
      "content-type": file.contentType,
    },
    payload: file.payload,
  });
}

describe("manual payment lifecycle", () => {
  it("corrupt proof is rejected with 415 before Payment, Order mutation or private storage writes", async () => {
    const fixture = await createFixture();
    try {
      const before = structuredClone(fixture.repository.order);
      const file = multipartProof(png.subarray(0, 8), "image/png");
      const response = await fixture.app.inject({
        method: "POST",
        url: "/orders/STZ-ORDER-001/payments",
        headers: {
          authorization: `Bearer ${fixture.customerToken}`,
          "idempotency-key": "corrupt-proof-attempt",
          "content-type": file.contentType,
        },
        payload: file.payload,
      });
      expect(response.statusCode).toBe(415);
      expect(fixture.repository.payments).toHaveLength(0);
      expect(fixture.repository.order).toEqual(before);
      expect(fixture.repository.audit).toHaveLength(0);
      expect(fixture.storage.files.size).toBe(0);
      expect(fixture.notificationProvider.messages).toHaveLength(0);
    } finally {
      await fixture.app.close();
    }
  });
  it("a thrown notification after committed payment preserves the proof and successful submission", async () => {
    const fixture = await createFixture();
    const spy = vi
      .spyOn(NotificationService.prototype, "paymentSubmitted")
      .mockRejectedValue(new Error("notification storage unavailable"));
    try {
      const submitted = await fixture.service.submit(
        "user-1",
        "STZ-ORDER-001",
        "notification-db-down",
        { data: png, declaredMimeType: "image/png" },
      );
      expect(submitted.status).toBe("SUBMITTED");
      expect(fixture.repository.payments).toHaveLength(1);
      expect(fixture.storage.files.size).toBe(1);
    } finally {
      spy.mockRestore();
      await fixture.app.close();
    }
  });
  it("returns server-controlled payment instructions only to the order owner", async () => {
    const fixture = await createFixture();
    const owner = await fixture.app.inject({
      method: "GET",
      url: "/orders/STZ-ORDER-001/payment-instructions",
      headers: { authorization: `Bearer ${fixture.customerToken}` },
    });
    const stranger = await fixture.app.inject({
      method: "GET",
      url: "/orders/STZ-ORDER-001/payment-instructions",
      headers: { authorization: `Bearer ${fixture.otherCustomerToken}` },
    });

    expect(owner.statusCode).toBe(200);
    expect(owner.json()).toMatchObject({
      paymentInstructions: {
        phase: "PREPAYMENT",
        amount: 51,
        currency: "UZS",
        cardHolder: "STENZO WEAR",
        canSubmit: true,
        latestPayment: null,
        maxProofUploadSize: 1024,
      },
    });
    expect(stranger.statusCode).toBe(404);
    await fixture.app.close();
  });

  it("returns only owner-safe latest attempt details, including rejection reason and final phase", async () => {
    const fixture = await createFixture();
    const submitted = await submitPrepayment(fixture);
    const id = submitted.json<{ payment: { id: string } }>().payment.id;
    await fixture.service.reject(
      id,
      "admin",
      "Please upload a readable receipt",
    );
    const rejected = await fixture.app.inject({
      method: "GET",
      url: "/orders/STZ-ORDER-001/payment-instructions",
      headers: { authorization: `Bearer ${fixture.customerToken}` },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      paymentInstructions: {
        canSubmit: true,
        latestPayment: {
          id,
          type: "PREPAYMENT",
          status: "REJECTED",
          expectedAmount: 51,
          rejectionReason: "Please upload a readable receipt",
        },
      },
    });
    expect(rejected.body).not.toContain("proofStorageKey");
    expect(rejected.body).not.toContain("payment-proofs/");
    expect(rejected.body).not.toContain("reviewedByUserId");
    const retry = await submitPrepayment(fixture, "prepayment-new-proof-key");
    const secondId = retry.json<{ payment: { id: string } }>().payment.id;
    await fixture.service.approve(secondId, "admin");
    for (const status of [
      "PURCHASED",
      "IN_TRANSIT",
      "ARRIVED",
      "WEIGHING",
    ] as const)
      await fixture.service.transitionOrder("STZ-ORDER-001", status, "admin");
    await fixture.service.requestFinalPayment("STZ-ORDER-001", 20, "admin");
    const final = await fixture.service.getInstructions(
      "user-1",
      "STZ-ORDER-001",
    );
    expect(final).toMatchObject({
      phase: "FINAL",
      amount: 70,
      canSubmit: true,
      latestPayment: { type: "PREPAYMENT", status: "APPROVED" },
    });
    expect(fixture.repository.payments).toHaveLength(2);
    await fixture.app.close();
  });

  it("submits a private proof idempotently and ignores any client amount", async () => {
    const fixture = await createFixture();
    const first = await submitPrepayment(fixture);
    const second = await submitPrepayment(fixture);

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      payment: {
        type: "PREPAYMENT",
        status: "SUBMITTED",
        expectedAmount: 51,
      },
    });
    expect(second.json()).toEqual(first.json());
    expect(fixture.repository.payments).toHaveLength(1);
    expect(fixture.repository.order.status).toBe("PREPAYMENT_SUBMITTED");
    expect([...fixture.storage.files.keys()]).toEqual([
      expect.stringMatching(/^payment-proofs\/[a-f0-9-]+\.png$/),
    ]);
    expect(fixture.notificationProvider.messages).toHaveLength(1);
    expect(fixture.notificationProvider.messages[0]).toMatchObject({
      chatId: "42",
      text: expect.stringContaining("Предоплата"),
    });
    await fixture.app.close();
  });

  it("compensates the losing private upload during concurrent duplicate submits", async () => {
    const fixture = await createFixture();
    const submissions = await Promise.all([
      fixture.service.submit(
        "user-1",
        "STZ-ORDER-001",
        "concurrent-submit-key",
        {
          data: png,
          declaredMimeType: "image/png",
        },
      ),
      fixture.service.submit(
        "user-1",
        "STZ-ORDER-001",
        "concurrent-submit-key",
        {
          data: png,
          declaredMimeType: "image/png",
        },
      ),
    ]);

    expect(submissions[0]).toEqual(submissions[1]);
    expect(fixture.repository.payments).toHaveLength(1);
    expect(fixture.storage.files.size).toBe(1);
    expect(fixture.storage.deleted).toHaveLength(1);
    expect(fixture.notificationProvider.messages).toHaveLength(1);
    await fixture.app.close();
  });

  it("rejects unsafe proof MIME and never exposes proofs to customers", async () => {
    const fixture = await createFixture();
    const svg = multipartProof(Buffer.from("<svg></svg>"), "image/svg+xml");
    const unsupported = await fixture.app.inject({
      method: "POST",
      url: "/orders/STZ-ORDER-001/payments",
      headers: {
        authorization: `Bearer ${fixture.customerToken}`,
        "idempotency-key": "unsafe-proof-attempt",
        "content-type": svg.contentType,
      },
      payload: svg.payload,
    });
    expect(unsupported.statusCode).toBe(415);

    const submitted = await submitPrepayment(fixture);
    const paymentId = submitted.json<{ payment: { id: string } }>().payment.id;
    const customerProof = await fixture.app.inject({
      method: "GET",
      url: `/admin/payments/${paymentId}/proof`,
      headers: { authorization: `Bearer ${fixture.customerToken}` },
    });
    const adminProof = await fixture.app.inject({
      method: "GET",
      url: `/admin/payments/${paymentId}/proof`,
      headers: { authorization: `Bearer ${fixture.adminToken}` },
    });

    expect(customerProof.statusCode).toBe(403);
    expect(adminProof.statusCode).toBe(200);
    expect(adminProof.headers["content-type"]).toContain("image/png");
    expect(adminProof.headers["cache-control"]).toBe("private, no-store");
    expect(adminProof.rawPayload).toEqual(png);
    await fixture.app.close();
  });

  it("approves prepayment exactly once and records financial/audit state", async () => {
    const fixture = await createFixture();
    const submitted = await submitPrepayment(fixture);
    const paymentId = submitted.json<{ payment: { id: string } }>().payment.id;
    const headers = { authorization: `Bearer ${fixture.adminToken}` };
    const approved = await fixture.app.inject({
      method: "POST",
      url: `/admin/payments/${paymentId}/approve`,
      headers,
    });
    const repeated = await fixture.app.inject({
      method: "POST",
      url: `/admin/payments/${paymentId}/approve`,
      headers,
    });

    expect(approved.statusCode).toBe(200);
    expect(repeated.statusCode).toBe(200);
    expect(fixture.repository.order).toMatchObject({
      status: "AWAITING_PURCHASE",
      paidAmount: 51,
      remainingAmount: 50,
    });
    expect(
      fixture.repository.audit.filter(
        (entry) => entry.action === "payment.approved",
      ),
    ).toHaveLength(1);
    const customerMessages = fixture.notificationProvider.messages.filter(
      ({ chatId }) => chatId === "101",
    );
    expect(customerMessages).toHaveLength(1);
    expect(customerMessages[0]!.text).toContain("Предоплата");
    expect(customerMessages[0]!.text).toContain("принят в работу");
    await fixture.app.close();
  });

  it("keeps rejected attempts and allows a new prepayment submission", async () => {
    const fixture = await createFixture();
    const first = await submitPrepayment(fixture);
    const firstId = first.json<{ payment: { id: string } }>().payment.id;
    const rejected = await fixture.app.inject({
      method: "POST",
      url: `/admin/payments/${firstId}/reject`,
      headers: { authorization: `Bearer ${fixture.adminToken}` },
      payload: { reason: "Сумма не видна" },
    });
    const second = await submitPrepayment(fixture, "prepayment-attempt-2");

    expect(rejected.statusCode).toBe(200);
    expect(second.statusCode).toBe(201);
    expect(fixture.repository.payments).toHaveLength(2);
    expect(fixture.repository.payments[1]).toMatchObject({
      id: firstId,
      status: "REJECTED",
      rejectionReason: "Сумма не видна",
    });
    expect(fixture.repository.order.status).toBe("PREPAYMENT_SUBMITTED");
    expect(
      fixture.notificationProvider.messages.find(({ text }) =>
        text.includes("Причина: Сумма не видна"),
      ),
    ).toBeTruthy();
    expect(
      fixture.notificationProvider.messages.find(({ text }) =>
        text.includes("Новая попытка оплаты"),
      ),
    ).toBeTruthy();
    await fixture.app.close();
  });

  it("lists filtered payment history for admins without exposing storage keys", async () => {
    const fixture = await createFixture();
    const first = await submitPrepayment(fixture);
    const firstId = first.json<{ payment: { id: string } }>().payment.id;
    await fixture.service.reject(firstId, "admin", "retry");
    await submitPrepayment(fixture, "prepayment-attempt-2");
    const response = await fixture.app.inject({
      method: "GET",
      url: "/admin/payments?type=PREPAYMENT&status=REJECTED",
      headers: { authorization: `Bearer ${fixture.adminToken}` },
    });

    const body = response.json<{
      payments: Array<{
        id: string;
        status: string;
        order: { paymentAttempts: Array<{ id: string }> };
      }>;
      nextCursor: string | null;
    }>();
    expect(response.statusCode).toBe(200);
    expect(body.nextCursor).toBeNull();
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({ id: firstId, status: "REJECTED" });
    expect(
      body.payments[0]!.order.paymentAttempts.map(({ id }) => id),
    ).toContain(firstId);
    expect(response.body).not.toContain("proofStorageKey");
    expect(response.body).not.toContain("payment-proofs/");
    await fixture.app.close();
  });

  it("enforces admin-only sequential operations and requests the final amount", async () => {
    const fixture = await createFixture();
    const submitted = await submitPrepayment(fixture);
    const paymentId = submitted.json<{ payment: { id: string } }>().payment.id;
    const adminHeaders = { authorization: `Bearer ${fixture.adminToken}` };
    await fixture.app.inject({
      method: "POST",
      url: `/admin/payments/${paymentId}/approve`,
      headers: adminHeaders,
    });
    const invalidSkip = await fixture.app.inject({
      method: "PATCH",
      url: "/admin/orders/STZ-ORDER-001/status",
      headers: adminHeaders,
      payload: { status: "IN_TRANSIT" },
    });
    expect(invalidSkip.statusCode).toBe(409);

    for (const status of ["PURCHASED", "IN_TRANSIT", "ARRIVED", "WEIGHING"]) {
      const transitioned = await fixture.app.inject({
        method: "PATCH",
        url: "/admin/orders/STZ-ORDER-001/status",
        headers: adminHeaders,
        payload: { status },
      });
      expect(transitioned.statusCode).toBe(200);
      if (status === "PURCHASED") {
        const replay = await fixture.app.inject({
          method: "PATCH",
          url: "/admin/orders/STZ-ORDER-001/status",
          headers: adminHeaders,
          payload: { status },
        });
        expect(replay.statusCode).toBe(200);
      }
    }
    const customerRequest = await fixture.app.inject({
      method: "POST",
      url: "/admin/orders/STZ-ORDER-001/request-final-payment",
      headers: { authorization: `Bearer ${fixture.customerToken}` },
      payload: { cargoAmount: 20 },
    });
    const finalRequest = await fixture.app.inject({
      method: "POST",
      url: "/admin/orders/STZ-ORDER-001/request-final-payment",
      headers: adminHeaders,
      payload: { cargoAmount: 20 },
    });
    const finalRequestReplay = await fixture.app.inject({
      method: "POST",
      url: "/admin/orders/STZ-ORDER-001/request-final-payment",
      headers: adminHeaders,
      payload: { cargoAmount: 20 },
    });

    expect(customerRequest.statusCode).toBe(403);
    expect(finalRequest.statusCode).toBe(200);
    expect(finalRequestReplay.statusCode).toBe(200);
    expect(finalRequest.json()).toMatchObject({
      order: {
        status: "AWAITING_FINAL_PAYMENT",
        cargoAmount: 20,
        payment: { phase: "FINAL", amountDue: 70 },
      },
    });
    expect(
      fixture.notificationProvider.messages.filter(({ text }) =>
        text.includes("Итого: 70 UZS"),
      ),
    ).toHaveLength(1);
    expect(
      fixture.notificationProvider.messages.find(({ text }) =>
        text.includes("находится в пути"),
      ),
    ).toBeTruthy();
    expect(
      fixture.notificationProvider.messages.filter(({ text }) =>
        text.includes("Товар выкуплен"),
      ),
    ).toHaveLength(1);
    await fixture.app.close();
  });

  it("completes final payment and shipping while preserving accounting invariants", async () => {
    const fixture = await createFixture();
    const prepayment = await fixture.service.submit(
      "user-1",
      "STZ-ORDER-001",
      "pre-direct",
      { data: png, declaredMimeType: "image/png" },
    );
    await fixture.service.approve(prepayment.id, "admin");
    for (const status of [
      "PURCHASED",
      "IN_TRANSIT",
      "ARRIVED",
      "WEIGHING",
    ] as const) {
      await fixture.service.transitionOrder("STZ-ORDER-001", status, "admin");
    }
    await fixture.service.requestFinalPayment("STZ-ORDER-001", 20, "admin");
    const finalPayment = await fixture.service.submit(
      "user-1",
      "STZ-ORDER-001",
      "final-direct",
      { data: png, declaredMimeType: "image/png" },
    );
    expect(finalPayment).toMatchObject({ type: "FINAL", expectedAmount: 70 });
    expect(
      fixture.notificationProvider.messages.find(
        ({ chatId, text }) =>
          chatId === "42" &&
          text.includes("Тип: Финальная оплата") &&
          text.includes("CARGO: 20 UZS") &&
          text.includes("Ожидаемая сумма: 70 UZS"),
      ),
    ).toBeTruthy();
    await fixture.service.approve(finalPayment.id, "admin");
    await fixture.service.approve(finalPayment.id, "admin");

    expect(fixture.repository.order).toMatchObject({
      status: "PAID_FULL",
      paidAmount: 101,
      remainingAmount: 0,
      cargoAmount: 20,
      cargoPaidAmount: 20,
    });
    for (const status of ["READY_TO_SHIP", "SHIPPED", "COMPLETED"] as const) {
      await fixture.service.transitionOrder("STZ-ORDER-001", status, "admin");
    }
    expect(fixture.repository.order.status).toBe("COMPLETED");
    expect(fixture.repository.audit).toContainEqual({
      action: "order.completed",
    });
    expect(
      fixture.notificationProvider.messages.filter(({ text }) =>
        text.includes("полностью оплачен"),
      ),
    ).toHaveLength(1);
    expect(
      fixture.notificationProvider.messages.find(({ text }) =>
        text.includes("Заказ завершён"),
      ),
    ).toBeTruthy();
    await fixture.app.close();
  });

  it("uses Uzbek customer preferredLocale even with Russian Telegram metadata", async () => {
    const fixture = await createFixture();
    fixture.repository.order.user.preferredLocale = "uz";
    const submitted = await fixture.service.submit(
      "user-1",
      "STZ-ORDER-001",
      "uzbek-template-key",
      { data: png, declaredMimeType: "image/png" },
    );
    await fixture.service.approve(submitted.id, "admin");

    const customerMessage = fixture.notificationProvider.messages.find(
      ({ chatId }) => chatId === "101",
    );
    expect(customerMessage?.text).toContain("oldindan to'lov tasdiqlandi");
    expect(customerMessage?.text).toContain("ishga qabul qilindi");
    await fixture.app.close();
  });

  it("resolves concurrent opposite reviews to one decision without double accounting", async () => {
    const fixture = await createFixture();
    const submitted = await fixture.service.submit(
      "user-1",
      "STZ-ORDER-001",
      "race",
      { data: png, declaredMimeType: "image/png" },
    );
    const results = await Promise.allSettled([
      fixture.service.approve(submitted.id, "admin"),
      fixture.service.reject(submitted.id, "admin", "race rejection"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(fixture.repository.order).toMatchObject({
      status: "AWAITING_PURCHASE",
      paidAmount: 51,
      remainingAmount: 50,
    });
    expect(
      fixture.repository.audit.filter((entry) =>
        ["payment.approved", "payment.rejected"].includes(entry.action),
      ),
    ).toHaveLength(1);
    await fixture.app.close();
  });
});
