import {
  coherentPayment,
  paymentError,
  paymentState,
  proofError,
  type PaymentData,
  type PaymentError,
  type PaymentAttempt,
  type PaymentOrder,
  type PaymentInstructions,
} from "./payment";
export interface PaymentSnapshot {
  data?: PaymentData;
  loading: boolean;
  busy: boolean;
  error?: PaymentError;
  sent?: boolean;
}
interface Attempt {
  publicId: string;
  phase: string;
  latestId: string | null;
  key: string;
}
export interface PaymentDependencies {
  order(id: string, token: string, signal: AbortSignal): Promise<PaymentOrder>;
  instructions(
    id: string,
    token: string,
    signal: AbortSignal,
  ): Promise<PaymentInstructions>;
  submit(
    id: string,
    file: File,
    key: string,
    token: string,
    signal: AbortSignal,
  ): Promise<PaymentAttempt>;
  token(): string | null;
  key(): string;
  read(): Attempt | null;
  write(attempt: Attempt): void;
}
const stamp = (data: PaymentData) =>
  JSON.stringify([
    data.order.status,
    data.instructions.phase,
    data.instructions.amount,
    data.instructions.canSubmit,
    data.instructions.latestPayment?.id,
    data.instructions.latestPaymentStatus,
    data.instructions.cardNumber,
    data.instructions.cardHolder,
    data.instructions.maxProofUploadSize,
  ]);
export class PaymentResource {
  private state: PaymentSnapshot = { loading: true, busy: false };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private disposed = false;
  private attempt?: Attempt;
  public constructor(
    private id: string,
    private api: PaymentDependencies,
  ) {}
  public snapshot = () => this.state;
  public activate() {
    this.disposed = false;
  }
  public subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch: Partial<PaymentSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private async fetch(signal: AbortSignal): Promise<PaymentData> {
    const token = this.api.token();
    if (!token) throw { status: 401 };
    const [order, instructions] = await Promise.all([
      this.api.order(this.id, token, signal),
      this.api.instructions(this.id, token, signal),
    ]);
    const data = { order, instructions };
    if (!coherentPayment(data)) throw { status: 409 };
    return data;
  }
  public async refresh(silent = false) {
    if (this.state.busy || this.disposed) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    this.emit({
      loading: !silent,
      error: silent ? this.state.error : undefined,
    });
    try {
      const data = await this.fetch(controller.signal);
      if (this.controller === controller && !controller.signal.aborted) {
        const changed =
          this.state.data && stamp(this.state.data) !== stamp(data);
        this.emit({
          data,
          loading: false,
          error: silent && !changed ? this.state.error : undefined,
        });
      }
    } catch (error) {
      if (this.controller === controller)
        this.emit({ loading: false, error: paymentError(error) });
    } finally {
      clearTimeout(timer);
    }
  }
  public async submit(file: File): Promise<boolean> {
    const original = this.state.data;
    if (!original || this.state.busy || this.state.loading || this.disposed)
      return false;
    if (!original.instructions.canSubmit) {
      this.emit({
        error:
          paymentState(original) === "pending"
            ? "alreadySubmitted"
            : "invalidStatus",
      });
      return false;
    }
    const invalid = proofError(file, original.instructions.maxProofUploadSize);
    if (invalid) {
      this.emit({ error: invalid });
      return false;
    }
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 45000);
    this.emit({ busy: true, error: undefined, sent: false });
    try {
      const current = await this.fetch(controller.signal);
      if (controller.signal.aborted || this.disposed) return false;
      this.emit({ data: current });
      if (stamp(original) !== stamp(current)) {
        this.emit({
          error:
            paymentState(current) === "pending"
              ? "alreadySubmitted"
              : "changed",
        });
        return false;
      }
      const stored = this.attempt ?? this.api.read();
      const latestId = current.instructions.latestPayment?.id ?? null;
      const attempt =
        stored?.publicId === this.id &&
        stored.phase === current.instructions.phase &&
        stored.latestId === latestId
          ? stored
          : {
              publicId: this.id,
              phase: current.instructions.phase!,
              latestId,
              key: this.api.key(),
            };
      // Persist before uploading: a lost response or a remount retries the same operation.
      this.api.write(attempt);
      this.attempt = attempt;
      const token = this.api.token();
      if (!token) throw { status: 401 };
      const payment = await this.api.submit(
        this.id,
        file,
        attempt.key,
        token,
        controller.signal,
      );
      if (controller.signal.aborted || this.disposed) return false;
      if (
        payment.type !== current.instructions.phase ||
        payment.expectedAmount !== current.instructions.amount
      )
        throw { status: 409 };
      this.emit({
        sent: payment.status === "SUBMITTED",
        data: {
          order: current.order,
          instructions: {
            ...current.instructions,
            latestPayment: payment,
            latestPaymentStatus: payment.status,
            canSubmit: false,
          },
        },
      });
      try {
        this.emit({ data: await this.fetch(controller.signal) });
      } catch {
        this.emit({ error: "network" });
      }
      return true;
    } catch (error) {
      this.emit({ error: paymentError(error) });
      return false;
    } finally {
      clearTimeout(timer);
      this.emit({ busy: false });
    }
  }
  public dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.controller = undefined;
  }
}
// Only the idempotency token and order/phase identifiers; never proof bytes or JWT.
export function readPaymentAttempt(): Attempt | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem("voyey.payment-attempt") ?? "null",
    );
    return value &&
      typeof value.publicId === "string" &&
      ["PREPAYMENT", "FINAL"].includes(value.phase) &&
      (value.latestId === null || typeof value.latestId === "string") &&
      /^[A-Za-z0-9._:-]{16,200}$/.test(value.key)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function writePaymentAttempt(value: Attempt) {
  try {
    sessionStorage.setItem("voyey.payment-attempt", JSON.stringify(value));
  } catch {
    /* In-memory locking and server validation remain active. */
  }
}
