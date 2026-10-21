import { createPublicOrderId, prepareOrder } from "./domain.js";
import type { OrderRepository } from "../orders/repository.js";
import { toOrderDto } from "../orders/service.js";
import type { OrderDto, RecipientInput } from "../orders/types.js";
import type { NotificationService } from "../notifications/index.js";

export class CheckoutService {
  public constructor(
    private readonly repository: OrderRepository,
    private readonly createOrderId: () => string = createPublicOrderId,
    private readonly notifications?: NotificationService,
  ) {}

  public async checkout(
    userId: string,
    idempotencyKey: string,
    recipient: RecipientInput,
    promoCode?: string,
  ): Promise<OrderDto> {
    const result = await this.repository.checkout({
      userId,
      idempotencyKey,
      publicId: this.createOrderId(),
      recipient,
      promoCode,
      prepare: prepareOrder,
    });
    try {
      await this.notifications?.orderCreated(result.order, !result.created);
    } catch {
      /* The committed order must survive notification failures. */
    }
    return toOrderDto(result.order);
  }
}
