import { z } from "zod";
import { HttpError } from "../auth/errors.js";
import { recipientSchema } from "../orders/schemas.js";
import { splitFinanceSelectionSchema } from "./finance.js";
import { LinkedCheckoutCommit } from "./group-commit.js";

const selection = splitFinanceSelectionSchema
  .extend({
    saleMode: z.enum(["IN_STOCK", "PREORDER"]),
    recipient: recipientSchema,
  })
  .strict();

/** Internal opt-in only. No HTTP registration or environment activation switch. */
export class SaleModeCheckoutCommit {
  constructor(private readonly enabled = false) {}
  async create(userId: string, key: string, value: unknown) {
    if (!this.enabled)
      throw new HttpError(503, "Sale-mode checkout is disabled");
    const parsed = selection.safeParse(value);
    if (!parsed.success)
      throw new HttpError(400, "Select exactly one sale mode");
    const { saleMode, ...request } = parsed.data;
    return new LinkedCheckoutCommit(true, saleMode).create(
      userId,
      key,
      request,
    );
  }
}
