import { createHash, randomUUID } from "node:crypto";
import { atomic, database, type Batch } from "@stenzo/database";
import { z } from "zod";
import { VoyeyOwnerAuthority } from "../admin/owner.js";
import { HttpError } from "../auth/errors.js";
import { idempotencyKeySchema } from "../orders/schemas.js";
import { calculateOutstanding, type GroupFinance } from "./finance.js";
import { readOrderFinance } from "./payment-state.js";

const arrivalSchema = z
  .object({
    arrivedAt: z.iso.datetime().transform((value) => new Date(value).getTime()),
    items: z
      .array(
        z
          .object({
            itemId: z.string().min(1).max(100),
            quantity: z.number().int().min(1).max(99),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
const cargoSchema = z
  .object({ amount: z.number().int().min(0).max(2147483647) })
  .strict();
const invoiceSchema = z.object({}).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "Invalid preorder finance request");
  return result.data;
}
const fingerprint = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
type Kind = "CheckoutArrival" | "CheckoutCargoCharge" | "CheckoutFinalInvoice";
type Action = "PREORDER_ARRIVAL" | "CARGO_CHANGE" | "FINAL_INVOICE";
type OperationRow = {
  id: string;
  orderId: string;
  operationKey: string;
  requestFingerprint: string;
  createdBy: string;
  createdAt: number;
};
type ArrivalRow = OperationRow & { arrivedAt: number; itemSnapshot: string };
type CargoRow = OperationRow & {
  arrivalId: string;
  version: 1;
  amount: number;
};
export type FinalInvoiceRow = OperationRow & {
  arrivalId: string;
  cargoChargeId: string;
  firstLedgerId: string;
  version: 1;
  currency: "UZS";
  goodsTotal: number;
  firstGoodsPaid: number;
  goodsDue: number;
  cargoDue: number;
  totalDue: number;
};

/** Internal, default-off. Full arrival only; immutable cargo version/invoice, no corrections or fulfillment. */
export class PreorderFinance {
  constructor(
    private readonly owner: VoyeyOwnerAuthority,
    private readonly enabled = false,
  ) {}
  private async run<T>(
    authorization: string | undefined,
    action: Action,
    operation: (b: Batch, actor: string) => Promise<T>,
  ) {
    if (!this.enabled)
      throw new HttpError(503, "Preorder finance is internal and disabled");
    const result = await atomic(async (b) => {
      const authority = await this.owner.inspect(
        b,
        await this.owner.identify(authorization),
        action,
      );
      if (authority.reason !== "AUTHORIZED")
        return { denied: authority, value: null };
      return { denied: null, value: await operation(b, authority.userId!) };
    });
    if (result.denied) this.owner.require(result.denied);
    return result.value!;
  }
  private async preorder(orderId: string) {
    const state = await readOrderFinance(orderId);
    if (state.saleMode !== "PREORDER")
      throw new HttpError(
        409,
        "Only PREORDER supports arrival/cargo/final invoice",
      );
    return state;
  }
  private async existing(
    kind: Kind,
    orderId: string,
    key: string,
    fp: string,
    actor: string,
  ) {
    const old = await database()
      .prepare(`SELECT * FROM ${kind} WHERE orderId=?`)
      .bind(orderId)
      .first<OperationRow>();
    if (old) {
      if (old.operationKey !== key || old.requestFingerprint !== fp)
        throw new HttpError(
          409,
          "Immutable operation already exists; incompatible key or parameters",
        );
      return old;
    }
    if (
      await database()
        .prepare(`SELECT id FROM ${kind} WHERE createdBy=? AND operationKey=?`)
        .bind(actor, key)
        .first()
    )
      throw new HttpError(409, "Operation key belongs to another order");
    return null;
  }
  private audit(
    b: Batch,
    actor: string,
    action: string,
    kind: Kind,
    id: string,
    orderId: string,
  ) {
    b.insert("AuditLog", {
      actorId: actor,
      action,
      entityType: kind,
      entityId: id,
      metadata: { orderId },
    });
  }
  private async snapshot(orderId: string) {
    return atomic(async () => ({
      arrival: await database()
        .prepare("SELECT * FROM CheckoutArrival WHERE orderId=?")
        .bind(orderId)
        .first<ArrivalRow>(),
      cargo: await database()
        .prepare("SELECT * FROM CheckoutCargoCharge WHERE orderId=?")
        .bind(orderId)
        .first<CargoRow>(),
      invoice: await database()
        .prepare("SELECT * FROM CheckoutFinalInvoice WHERE orderId=?")
        .bind(orderId)
        .first<FinalInvoiceRow>(),
      finance: await readOrderFinance(orderId),
    }));
  }
  async arrive(
    authorization: string | undefined,
    orderId: string,
    key: string,
    value: unknown,
  ) {
    key = parse(idempotencyKeySchema, key);
    const data = parse(arrivalSchema, value),
      items = [...data.items].sort((a, b) => a.itemId.localeCompare(b.itemId));
    const fp = fingerprint({
      operation: "ARRIVAL_V1",
      orderId,
      arrivedAt: data.arrivedAt,
      items,
    });
    await this.run(authorization, "PREORDER_ARRIVAL", async (b, actor) => {
      await this.preorder(orderId);
      if (await this.existing("CheckoutArrival", orderId, key, fp, actor))
        return;
      const now = Date.now();
      const order = await database()
        .prepare("SELECT createdAt FROM CheckoutOrder WHERE id=?")
        .bind(orderId)
        .first<{ createdAt: number }>();
      const expected = (
        await database()
          .prepare(
            "SELECT id,variantId,quantity FROM CheckoutOrderItem WHERE orderId=? ORDER BY id",
          )
          .bind(orderId)
          .all<{ id: string; variantId: string; quantity: number }>()
      ).results;
      const received = new Map(
        items.map((item) => [item.itemId, item.quantity]),
      );
      if (
        data.arrivedAt < order!.createdAt ||
        data.arrivedAt > now ||
        items.length !== expected.length ||
        received.size !== items.length ||
        expected.some((item) => received.get(item.id) !== item.quantity)
      )
        throw new HttpError(
          409,
          "Confirm all preorder items and a valid actual arrival date",
        );
      const id = randomUUID();
      b.sql(
        "INSERT INTO CheckoutArrival(id,orderId,arrivedAt,itemSnapshot,createdBy,createdAt,operationKey,requestFingerprint) VALUES(?,?,?,?,?,?,?,?)",
        id,
        orderId,
        data.arrivedAt,
        expected.map((i) => ({
          itemId: i.id,
          variantId: i.variantId,
          quantity: i.quantity,
        })),
        actor,
        now,
        key,
        fp,
      );
      this.audit(b, actor, "preorder.arrived", "CheckoutArrival", id, orderId);
    });
    return this.snapshot(orderId);
  }
  async assignCargo(
    authorization: string | undefined,
    orderId: string,
    key: string,
    value: unknown,
  ) {
    key = parse(idempotencyKeySchema, key);
    const data = parse(cargoSchema, value),
      fp = fingerprint({ operation: "CARGO_V1", orderId, amount: data.amount });
    await this.run(authorization, "CARGO_CHANGE", async (b, actor) => {
      const state = await this.preorder(orderId);
      if (await this.existing("CheckoutCargoCharge", orderId, key, fp, actor))
        return;
      if (!state.arrivalId)
        throw new HttpError(409, "Cargo requires confirmed full arrival");
      if (state.goodsTotal + data.amount > 2147483647)
        throw new HttpError(409, "Goods and cargo amount limit");
      const id = randomUUID();
      b.sql(
        "INSERT INTO CheckoutCargoCharge(id,orderId,arrivalId,version,amount,createdBy,createdAt,operationKey,requestFingerprint) VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        orderId,
        state.arrivalId,
        1,
        data.amount,
        actor,
        Date.now(),
        key,
        fp,
      );
      this.audit(
        b,
        actor,
        "preorder.cargo-assigned",
        "CheckoutCargoCharge",
        id,
        orderId,
      );
    });
    return this.snapshot(orderId);
  }
  async issueInvoice(
    authorization: string | undefined,
    orderId: string,
    key: string,
    value: unknown = {},
  ) {
    key = parse(idempotencyKeySchema, key);
    parse(invoiceSchema, value);
    const fp = fingerprint({ operation: "FINAL_INVOICE_V1", orderId });
    await this.run(authorization, "FINAL_INVOICE", async (b, actor) => {
      const state = await this.preorder(orderId);
      if (await this.existing("CheckoutFinalInvoice", orderId, key, fp, actor))
        return;
      if (
        !state.arrivalId ||
        !state.cargoChargeId ||
        state.cargoAmount === null ||
        state.firstPaymentState !== "CONFIRMED"
      )
        throw new HttpError(
          409,
          "Final invoice requires arrival, known cargo and confirmed FIRST payment",
        );
      const order = await database()
        .prepare("SELECT financialPolicy FROM CheckoutOrder WHERE id=?")
        .bind(orderId)
        .first<{ financialPolicy: string }>();
      const first = await database()
        .prepare(
          "SELECT id,goodsAmount,cargoAmount FROM CheckoutPaymentLedger WHERE orderId=? AND phase='FIRST'",
        )
        .bind(orderId)
        .first<{ id: string; goodsAmount: number; cargoAmount: number }>();
      if (!first) throw new HttpError(409, "Confirmed FIRST ledger missing");
      const outstanding = calculateOutstanding(
        JSON.parse(order!.financialPolicy) as GroupFinance,
        [
          {
            ...first,
            status: "APPROVED",
            amount: first.goodsAmount + first.cargoAmount,
          },
        ],
        { arrived: true, amount: state.cargoAmount },
      );
      const id = randomUUID();
      b.sql(
        "INSERT INTO CheckoutFinalInvoice(id,orderId,arrivalId,cargoChargeId,firstLedgerId,version,currency,goodsTotal,firstGoodsPaid,goodsDue,cargoDue,totalDue,createdBy,createdAt,operationKey,requestFingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        orderId,
        state.arrivalId,
        state.cargoChargeId,
        first.id,
        1,
        "UZS",
        state.goodsTotal,
        first.goodsAmount,
        outstanding.goodsOutstanding,
        outstanding.cargoOutstanding,
        outstanding.finalAmountDue,
        actor,
        Date.now(),
        key,
        fp,
      );
      this.audit(
        b,
        actor,
        "preorder.final-invoiced",
        "CheckoutFinalInvoice",
        id,
        orderId,
      );
    });
    return this.snapshot(orderId);
  }
}
