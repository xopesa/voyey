import type {
  OrderPaymentRecord,
  OrderRecord,
  PaymentPhase,
  PaymentStatusValue,
} from "../orders/types.js";

export interface PaymentRecord extends OrderPaymentRecord {
  orderId: string;
  idempotencyKey: string;
  proofStorageKey: string;
  proofMimeType: string;
  reviewedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminPaymentRecord extends PaymentRecord {
  order: OrderRecord;
  reviewedBy: {
    id: string;
    telegramId: bigint;
    username: string | null;
  } | null;
}

export interface SubmitPaymentInput {
  userId: string;
  orderPublicId: string;
  idempotencyKey: string;
  proofStorageKey: string;
  proofMimeType: string;
}

export interface PaymentListQuery {
  status?: PaymentStatusValue;
  type?: PaymentPhase;
  limit: number;
  cursor?: string;
}

export interface PaymentListResult {
  payments: AdminPaymentRecord[];
  nextCursor: string | null;
}

export interface PaymentDto {
  id: string;
  orderPublicId: string;
  type: PaymentPhase;
  status: PaymentStatusValue;
  expectedAmount: number;
  rejectionReason: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
}

export interface PaymentInstructionsDto {
  orderPublicId: string;
  phase: PaymentPhase | null;
  amount: number;
  canSubmit: boolean;
  latestPaymentStatus: PaymentStatusValue | null;
  latestPayment: PaymentDto | null;
  maxProofUploadSize: number;
  currency: "UZS";
  cardNumber: string;
  cardHolder: string;
  instructionsRu: string;
  instructionsUz: string;
}

export interface PaymentProof {
  data: Buffer;
  mimeType: string;
}
