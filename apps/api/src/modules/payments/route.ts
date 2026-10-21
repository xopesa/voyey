import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { createAdminGuard } from "../admin/authorization.js";
import { HttpError } from "../auth/errors.js";
import { createAuthGuard } from "../auth/middleware.js";
import type { JwtTokenService } from "../auth/token.js";
import {
  ImageTooLargeError,
  ImageTypeMismatchError,
  InvalidStorageKeyError,
  MediaStorageError,
  MediaStorageUnavailableError,
  UnsupportedImageTypeError,
} from "../media/index.js";
import {
  InvalidOrderStatusTransitionError,
  OrderNotFoundError,
  OrderTransitionConflictError,
} from "../orders/errors.js";
import {
  finalPaymentRequestSchema,
  idempotencyKeySchema,
  orderStatusPatchSchema,
  publicOrderParamsSchema,
} from "../orders/schemas.js";
import type { UserService } from "../users/index.js";
import {
  FinalPaymentRequestNotAllowedError,
  FinalPaymentAmountTooLargeError,
  PaymentAmountMismatchError,
  PaymentConflictError,
  PaymentInvalidCursorError,
  PaymentNotFoundError,
  PaymentReviewNotAllowedError,
  PaymentSubmissionNotAllowedError,
} from "./errors.js";
import {
  paymentIdParamsSchema,
  paymentListQuerySchema,
  rejectPaymentSchema,
} from "./schemas.js";
import type { PaymentService } from "./service.js";

function currentUserId(request: FastifyRequest): string {
  const id = request.currentUser?.id;
  if (!id) throw new HttpError(401, "Invalid access token");
  return id;
}

function adminActorId(request: FastifyRequest): string {
  return request.webAdminActor ?? currentUserId(request);
}

async function mapPaymentError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof OrderNotFoundError ||
      error instanceof PaymentNotFoundError
    ) {
      throw new HttpError(404, error.message);
    }
    if (error instanceof PaymentInvalidCursorError) {
      throw new HttpError(400, error.message);
    }
    if (error instanceof FinalPaymentAmountTooLargeError)
      throw new HttpError(400, error.message);
    if (
      error instanceof PaymentSubmissionNotAllowedError ||
      error instanceof PaymentReviewNotAllowedError ||
      error instanceof PaymentAmountMismatchError ||
      error instanceof PaymentConflictError ||
      error instanceof InvalidOrderStatusTransitionError ||
      error instanceof OrderTransitionConflictError ||
      error instanceof FinalPaymentRequestNotAllowedError
    ) {
      throw new HttpError(409, error.message);
    }
    if (error instanceof ImageTooLargeError) {
      throw new HttpError(413, error.message);
    }
    if (
      error instanceof UnsupportedImageTypeError ||
      error instanceof ImageTypeMismatchError
    ) {
      throw new HttpError(415, error.message);
    }
    if (error instanceof InvalidStorageKeyError) {
      throw new HttpError(400, error.message);
    }
    if (
      error instanceof MediaStorageError ||
      error instanceof MediaStorageUnavailableError
    ) {
      throw new HttpError(502, error.message);
    }
    throw error;
  }
}

export function registerPaymentRoutes(
  app: FastifyInstance,
  service: PaymentService,
  tokenService: JwtTokenService,
  userService: UserService,
  adminTokenService: JwtTokenService,
  adminUserService: UserService,
  adminTelegramIds: ReadonlySet<string>,
  maxProofUploadSize: number,
): void {
  const authGuard = createAuthGuard(tokenService, userService);
  const adminGuard = createAdminGuard(
    adminTokenService,
    adminUserService,
    adminTelegramIds,
  );

  app.get(
    "/orders/:publicId/payment-instructions",
    { preHandler: authGuard },
    async (request) => {
      const params = publicOrderParamsSchema.safeParse(request.params);
      if (!params.success) throw new HttpError(400, "Invalid order id");
      return {
        paymentInstructions: await mapPaymentError(() =>
          service.getInstructions(currentUserId(request), params.data.publicId),
        ),
      };
    },
  );

  void app.register(async (uploadScope) => {
    await uploadScope.register(multipart, {
      limits: { files: 1, fields: 0, parts: 1, fileSize: maxProofUploadSize },
    });
    uploadScope.post(
      "/orders/:publicId/payments",
      {
        preHandler: authGuard,
        bodyLimit: maxProofUploadSize + 64 * 1024,
      },
      async (request, reply) => {
        const params = publicOrderParamsSchema.safeParse(request.params);
        if (!params.success) throw new HttpError(400, "Invalid order id");
        const key = idempotencyKeySchema.safeParse(
          request.headers["idempotency-key"],
        );
        if (!key.success) {
          throw new HttpError(
            400,
            "A valid Idempotency-Key header is required",
          );
        }
        try {
          const file = await request.file();
          if (!file || file.fieldname !== "file") {
            throw new HttpError(
              400,
              "A multipart image field named 'file' is required",
            );
          }
          const data = await file.toBuffer();
          if (file.file.truncated) {
            throw new ImageTooLargeError(maxProofUploadSize);
          }
          const payment = await mapPaymentError(() =>
            service.submit(
              currentUserId(request),
              params.data.publicId,
              key.data,
              { data, declaredMimeType: file.mimetype },
            ),
          );
          return reply.status(201).send({ payment });
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "FST_REQ_FILE_TOO_LARGE"
          ) {
            throw new HttpError(
              413,
              `Image exceeds the ${maxProofUploadSize} byte upload limit`,
            );
          }
          if (error instanceof HttpError) throw error;
          return mapPaymentError(async () => Promise.reject(error));
        }
      },
    );
  });

  app.get("/admin/payments", { preHandler: adminGuard }, async (request) => {
    const query = paymentListQuerySchema.safeParse(request.query);
    if (!query.success) throw new HttpError(400, "Invalid payments query");
    return mapPaymentError(() => service.listForAdmin(query.data));
  });

  app.get(
    "/admin/payments/:id",
    { preHandler: adminGuard },
    async (request) => {
      const params = paymentIdParamsSchema.safeParse(request.params);
      if (!params.success) throw new HttpError(400, "Invalid payment id");
      return {
        payment: await mapPaymentError(() =>
          service.getForAdmin(params.data.id),
        ),
      };
    },
  );

  app.get(
    "/admin/payments/:id/proof",
    { preHandler: adminGuard },
    async (request, reply) => {
      const params = paymentIdParamsSchema.safeParse(request.params);
      if (!params.success) throw new HttpError(400, "Invalid payment id");
      const proof = await mapPaymentError(() =>
        service.getProofForAdmin(params.data.id),
      );
      return reply
        .type(proof.mimeType)
        .header("Cache-Control", "private, no-store")
        .send(proof.data);
    },
  );

  app.post(
    "/admin/payments/:id/approve",
    { preHandler: adminGuard },
    async (request) => {
      const params = paymentIdParamsSchema.safeParse(request.params);
      if (!params.success) throw new HttpError(400, "Invalid payment id");
      return {
        payment: await mapPaymentError(() =>
          service.approve(params.data.id, adminActorId(request)),
        ),
      };
    },
  );

  app.post(
    "/admin/payments/:id/reject",
    { preHandler: adminGuard },
    async (request) => {
      const params = paymentIdParamsSchema.safeParse(request.params);
      if (!params.success) throw new HttpError(400, "Invalid payment id");
      const body = rejectPaymentSchema.safeParse(request.body);
      if (!body.success) throw new HttpError(400, "Invalid rejection payload");
      return {
        payment: await mapPaymentError(() =>
          service.reject(
            params.data.id,
            adminActorId(request),
            body.data.reason,
          ),
        ),
      };
    },
  );

  app.patch(
    "/admin/orders/:publicId/status",
    { preHandler: adminGuard },
    async (request) => {
      const params = publicOrderParamsSchema.safeParse(request.params);
      if (!params.success) throw new HttpError(400, "Invalid order id");
      const body = orderStatusPatchSchema.safeParse(request.body);
      if (!body.success)
        throw new HttpError(400, "Invalid order status payload");
      return {
        order: await mapPaymentError(() =>
          service.transitionOrder(
            params.data.publicId,
            body.data.status,
            adminActorId(request),
          ),
        ),
      };
    },
  );

  app.post(
    "/admin/orders/:publicId/request-final-payment",
    { preHandler: adminGuard },
    async (request) => {
      const params = publicOrderParamsSchema.safeParse(request.params);
      if (!params.success) throw new HttpError(400, "Invalid order id");
      const body = finalPaymentRequestSchema.safeParse(request.body);
      if (!body.success) throw new HttpError(400, "Invalid cargo amount");
      return {
        order: await mapPaymentError(() =>
          service.requestFinalPayment(
            params.data.publicId,
            body.data.cargoAmount,
            adminActorId(request),
          ),
        ),
      };
    },
  );
}
