import { atomic, prisma, type Batch } from "@stenzo/database";
import {
  bannerTargets,
  type BannerInput,
  type PublicBanner,
} from "@stenzo/shared";
import { z } from "zod";
import { HttpError } from "../auth/errors.js";
import { adminAuditActor } from "../admin/audit-actor.js";
import type { ImageStorageService } from "../media/service.js";
import type { ImageUploadInput } from "../media/types.js";

export function marketingAudit(
  batch: Batch,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
) {
  const actor = adminAuditActor(actorId);
  batch.insert("AuditLog", {
    actorId: actor.actorId,
    action,
    entityType,
    entityId,
    metadata: actor.metadata,
  });
}
const text = z.string().trim().max(200);
const optionalText = z.string().trim().max(1000).nullable().default(null);
export const bannerSchema = z
  .object({
    titleRu: text,
    titleUz: text,
    subtitleRu: optionalText,
    subtitleUz: optionalText,
    buttonRu: text.nullable().default(null),
    buttonUz: text.nullable().default(null),
    targetType: z.enum(bannerTargets).default("NONE"),
    targetCategoryId: z.string().min(1).max(100).nullable().default(null),
    targetProductId: z.string().min(1).max(100).nullable().default(null),
    targetUrl: z
      .url()
      .max(2048)
      .refine((v) => {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password;
      })
      .nullable()
      .default(null),
    sortOrder: z.number().int().min(0).max(2147483647).default(0),
    isActive: z.boolean().default(false),
  })
  .strict();
export function parseBanner(value: unknown): BannerInput {
  const parsed = bannerSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "marketingInvalid");
  const b = parsed.data;
  if (
    (b.targetType === "CATEGORY") !== !!b.targetCategoryId ||
    (b.targetType === "PRODUCT") !== !!b.targetProductId ||
    (b.targetType === "URL") !== !!b.targetUrl
  )
    throw new HttpError(400, "marketingTargetInvalid");
  return b;
}
type BannerRecord = BannerInput & {
  id: string;
  imageUrl: string;
  storageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};
function adminDto(b: BannerRecord) {
  const fields = Object.fromEntries(
    Object.keys(bannerSchema.shape).map((key) => [
      key,
      b[key as keyof BannerRecord],
    ]),
  ) as unknown as BannerInput;
  return {
    ...fields,
    id: b.id,
    imageUrl: b.imageUrl,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}
async function targetExists(b: BannerInput) {
  if (
    b.targetCategoryId &&
    !(await prisma.category.findUnique({ where: { id: b.targetCategoryId } }))
  )
    throw new HttpError(400, "marketingTargetInvalid");
  if (
    b.targetProductId &&
    !(await prisma.product.findUnique({ where: { id: b.targetProductId } }))
  )
    throw new HttpError(400, "marketingTargetInvalid");
}
function activateValid(
  b:
    | BannerRecord
    | (BannerInput & { imageUrl?: string; storageKey?: string | null }),
) {
  if (b.isActive && (!b.titleRu || !b.titleUz || !b.imageUrl || !b.storageKey))
    throw new HttpError(400, "marketingImageRequired");
}
export class BannerService {
  constructor(private readonly storage: ImageStorageService) {}
  async record(id: string): Promise<BannerRecord> {
    const b = await prisma.banner.findUnique({ where: { id } });
    if (!b) throw new HttpError(404, "notFound");
    return b;
  }
  async list() {
    return (
      await prisma.banner.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })
    ).map(adminDto);
  }
  async create(actor: string, input: unknown) {
    const data = parseBanner(input);
    activateValid(data);
    const id = await atomic(async (batch) => {
      await targetExists(data);
      const id = batch.insert("Banner", {
        ...data,
        imageUrl: "",
        storageKey: null,
      });
      marketingAudit(batch, actor, "banner.create", "Banner", id);
      return id;
    });
    return adminDto(await this.record(id));
  }
  async update(actor: string, id: string, input: unknown) {
    const data = parseBanner(input);
    await atomic(async (batch) => {
      const current = await this.record(id);
      await targetExists(data);
      activateValid({ ...current, ...data });
      const { isActive, ...fields } = data;
      if (
        JSON.stringify(
          Object.fromEntries(
            Object.keys(fields).map((k) => [
              k,
              current[k as keyof BannerRecord],
            ]),
          ),
        ) !== JSON.stringify(fields)
      ) {
        batch.update("Banner", id, fields);
        marketingAudit(batch, actor, "banner.update", "Banner", id);
      }
      if (isActive !== current.isActive) {
        batch.update("Banner", id, { isActive });
        marketingAudit(
          batch,
          actor,
          isActive ? "banner.activate" : "banner.deactivate",
          "Banner",
          id,
        );
      }
    });
    return adminDto(await this.record(id));
  }
  async setActive(actor: string, id: string, active: boolean) {
    await atomic(async (batch) => {
      const current = await this.record(id);
      if (active) {
        const fields = Object.fromEntries(
          Object.keys(bannerSchema.shape).map((k) => [
            k,
            current[k as keyof BannerRecord],
          ]),
        );
        const input = parseBanner({ ...fields, isActive: true });
        await targetExists(input);
        activateValid({ ...current, ...input });
      }
      if (current.isActive === active) return;
      batch.update("Banner", id, { isActive: active });
      marketingAudit(
        batch,
        actor,
        active ? "banner.activate" : "banner.deactivate",
        "Banner",
        id,
      );
    });
    return adminDto(await this.record(id));
  }
  async upload(actor: string, id: string, input: ImageUploadInput) {
    await this.record(id);
    const stored = await this.storage.upload(input);
    let oldKey: string | null;
    try {
      oldKey = await atomic(async (batch) => {
        const current = await this.record(id);
        batch.update("Banner", id, {
          imageUrl: stored.url,
          storageKey: stored.key,
        });
        marketingAudit(batch, actor, "banner.update", "Banner", id);
        return current.storageKey;
      });
    } catch (error) {
      await this.storage.delete(stored.key);
      throw error;
    }
    if (oldKey && oldKey !== stored.key) await this.storage.delete(oldKey);
    return adminDto(await this.record(id));
  }
  async delete(actor: string, id: string) {
    const key = await atomic(async (batch) => {
      const b = await this.record(id);
      batch.delete("Banner", "id", id);
      marketingAudit(batch, actor, "banner.delete", "Banner", id);
      return b.storageKey;
    });
    if (key) await this.storage.delete(key);
    return { id };
  }
}
export async function publicBanners(): Promise<PublicBanner[]> {
  const banners = await prisma.banner.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      targetCategory: true,
      targetProduct: { include: { category: true } },
    },
  });
  return banners.map((b) => ({
    id: b.id,
    titleRu: b.titleRu,
    titleUz: b.titleUz,
    subtitleRu: b.subtitleRu,
    subtitleUz: b.subtitleUz,
    buttonRu: b.buttonRu,
    buttonUz: b.buttonUz,
    imageUrl: b.imageUrl,
    href:
      b.targetType === "CATALOG"
        ? "/catalog"
        : b.targetType === "CATEGORY" &&
            b.targetCategory?.isActive &&
            !b.targetCategory.archivedAt
          ? `/catalog?category=${encodeURIComponent(b.targetCategory.slug)}`
          : b.targetType === "PRODUCT" &&
              b.targetProduct?.status === "ACTIVE" &&
              !b.targetProduct.archivedAt &&
              !b.targetProduct.category.archivedAt &&
              b.targetProduct.category.isActive
            ? `/catalog/${encodeURIComponent(b.targetProduct.slug)}`
            : b.targetType === "URL" && b.targetUrl?.startsWith("https://")
              ? b.targetUrl
              : null,
  }));
}
