import {
  AdminCatalogManagedImageUrlError,
  AdminCatalogProductNotFoundError,
} from "./errors.js";
import {
  MediaStorageError,
  MediaStorageUnavailableError,
  type ImageStorageService,
} from "../../media/index.js";
import type { AdminCatalogRepository } from "./repository.js";
import type { VariantGeneratorRepository } from "./variant-generator.js";
import type { VariantGeneratorInput } from "@stenzo/shared";
import { validPromotion } from "@stenzo/shared";
import { HttpError } from "../../auth/errors.js";
import type { TelegramChannelPublisher } from "../../telegram-channel/publisher.js";
import type { ChannelPublication } from "@stenzo/shared";
import type {
  AdminCategoryRecord,
  AdminImageRecord,
  AdminProductListQuery,
  AdminProductListResult,
  AdminProductRecord,
  AdminVariantRecord,
  CategoryCreateInput,
  CategoryPatchInput,
  ProductCreateInput,
  ProductImageCreateInput,
  ProductImagePatchInput,
  ProductImageUploadInput,
  ProductPatchInput,
  ProductVariantCreateInput,
  ProductVariantPatchInput,
} from "./types.js";

export class AdminCatalogService {
  public constructor(
    private readonly repository: AdminCatalogRepository,
    private readonly imageStorage?: ImageStorageService,
    private readonly publisher?: Pick<
      TelegramChannelPublisher,
      "getPublication" | "publishProduct"
    >,
    private readonly variantGenerator?: VariantGeneratorRepository,
  ) {}

  public previewVariants(productId: string, input: VariantGeneratorInput) {
    if (!this.variantGenerator)
      throw new HttpError(503, "Variant generator unavailable");
    return this.variantGenerator.preview(productId, input);
  }

  public generateVariants(
    actor: string,
    productId: string,
    input: VariantGeneratorInput,
  ) {
    if (!this.variantGenerator)
      throw new HttpError(503, "Variant generator unavailable");
    return this.variantGenerator.apply(actor, productId, input);
  }

  public async getTelegramPublication(id: string): Promise<ChannelPublication> {
    await this.getProduct(id);
    return (
      this.publisher?.getPublication(id) ?? {
        status: "NOT_CONFIGURED",
        errorCode: "CHANNEL_NOT_CONFIGURED",
        retryAllowed: false,
      }
    );
  }
  public async publishTelegram(
    actor: string,
    id: string,
  ): Promise<ChannelPublication> {
    const product = await this.getProduct(id);
    if (product.archivedAt || product.category.archivedAt)
      throw new HttpError(409, "archiveProductLocked");
    try {
      return (
        (await this.publisher?.publishProduct(actor, id)) ?? {
          status: "NOT_CONFIGURED",
          errorCode: "CHANNEL_NOT_CONFIGURED",
          retryAllowed: false,
        }
      );
    } catch {
      return {
        status: "FAILED",
        errorCode: "PERSISTENCE_UNAVAILABLE",
        retryAllowed: false,
      };
    }
  }
  private async afterActivation(
    actor: string,
    product: AdminProductRecord,
  ): Promise<AdminProductRecord> {
    let telegramPublication: ChannelPublication;
    try {
      telegramPublication = await this.publishTelegram(actor, product.id);
    } catch {
      telegramPublication = {
        status: "FAILED",
        errorCode: "PERSISTENCE_UNAVAILABLE",
        retryAllowed: false,
      };
    }
    return { ...product, telegramPublication };
  }

  public listCategories(): Promise<AdminCategoryRecord[]> {
    return this.repository.listCategories();
  }

  public createCategory(
    actorId: string,
    input: CategoryCreateInput,
  ): Promise<AdminCategoryRecord> {
    return this.repository.createCategory(actorId, input);
  }

  public updateCategory(
    actorId: string,
    id: string,
    input: CategoryPatchInput,
  ): Promise<AdminCategoryRecord> {
    return this.repository.updateCategory(actorId, id, input);
  }

  public setCategoryActive(
    actorId: string,
    id: string,
    isActive: boolean,
  ): Promise<AdminCategoryRecord> {
    return this.repository.setCategoryActive(actorId, id, isActive);
  }

  public listProducts(
    query: AdminProductListQuery,
  ): Promise<AdminProductListResult> {
    return this.repository.listProducts(query);
  }

  public async getProduct(id: string): Promise<AdminProductRecord> {
    const product = await this.repository.getProduct(id);
    if (!product) throw new AdminCatalogProductNotFoundError();
    return product;
  }

  public async createProduct(
    actorId: string,
    input: ProductCreateInput,
    publishToChannel = false,
  ): Promise<AdminProductRecord> {
    if (!validPromotion(input))
      throw new HttpError(400, "Invalid product promotion");
    const product = await this.repository.createProduct(actorId, input);
    return publishToChannel === true && product.status === "ACTIVE"
      ? this.afterActivation(actorId, product)
      : product;
  }

  public async updateProduct(
    actorId: string,
    id: string,
    input: ProductPatchInput,
    publishToChannel = false,
  ): Promise<AdminProductRecord> {
    const previousStatus =
      input.status === "ACTIVE"
        ? (await this.getProduct(id)).status
        : undefined;
    const current = await this.getProduct(id);
    if (!validPromotion({ ...current, ...input }))
      throw new HttpError(400, "Invalid product promotion");
    const product = await this.repository.updateProduct(actorId, id, input);
    return publishToChannel === true &&
      previousStatus &&
      previousStatus !== "ACTIVE" &&
      product.status === "ACTIVE"
      ? this.afterActivation(actorId, product)
      : product;
  }

  public async setProductActive(
    actorId: string,
    id: string,
    isActive: boolean,
    publishToChannel = false,
  ): Promise<AdminProductRecord> {
    const product = await this.repository.setProductStatus(
      actorId,
      id,
      isActive ? "ACTIVE" : "INACTIVE",
    );
    return isActive && publishToChannel === true
      ? this.afterActivation(actorId, product)
      : product;
  }

  public createImage(
    actorId: string,
    productId: string,
    input: ProductImageCreateInput,
  ): Promise<AdminImageRecord> {
    return this.repository.createImage(actorId, productId, input);
  }

  public async uploadImage(
    actorId: string,
    productId: string,
    input: ProductImageUploadInput,
  ): Promise<AdminImageRecord> {
    if (!this.imageStorage) throw new MediaStorageUnavailableError();
    const product = await this.repository.getProduct(productId);
    if (!product) throw new AdminCatalogProductNotFoundError();

    const stored = await this.imageStorage.upload({
      data: input.data,
      declaredMimeType: input.declaredMimeType,
    });
    try {
      return await this.repository.createImage(actorId, productId, {
        url: stored.url,
        storageKey: stored.key,
        sortOrder: input.sortOrder,
        isPrimary: input.isPrimary,
      });
    } catch (databaseError) {
      try {
        await this.imageStorage.delete(stored.key);
      } catch (cleanupError) {
        throw new MediaStorageError(
          "Image metadata creation and uploaded file cleanup both failed",
          { cause: new AggregateError([databaseError, cleanupError]) },
        );
      }
      throw databaseError;
    }
  }

  public async updateImage(
    actorId: string,
    id: string,
    input: ProductImagePatchInput,
  ): Promise<AdminImageRecord> {
    if (input.url !== undefined) {
      const current = await this.repository.getImage(id);
      if (!current) return this.repository.updateImage(actorId, id, input);
      if (current.storageKey) throw new AdminCatalogManagedImageUrlError();
    }
    return this.repository.updateImage(actorId, id, input);
  }

  public async deleteImage(
    actorId: string,
    id: string,
  ): Promise<AdminImageRecord> {
    const deleted = await this.repository.deleteImage(actorId, id);
    if (deleted.storageKey) {
      if (!this.imageStorage) throw new MediaStorageUnavailableError();
      await this.imageStorage.delete(deleted.storageKey);
    }
    return deleted;
  }

  public createVariant(
    actorId: string,
    productId: string,
    input: ProductVariantCreateInput,
  ): Promise<AdminVariantRecord> {
    return this.repository.createVariant(actorId, productId, input);
  }

  public updateVariant(
    actorId: string,
    id: string,
    input: ProductVariantPatchInput,
  ): Promise<AdminVariantRecord> {
    return this.repository.updateVariant(actorId, id, input);
  }

  public setVariantActive(
    actorId: string,
    id: string,
    isActive: boolean,
  ): Promise<AdminVariantRecord> {
    return this.repository.setVariantActive(actorId, id, isActive);
  }
}
