export const bannerTargets = [
  "NONE",
  "CATALOG",
  "CATEGORY",
  "PRODUCT",
  "URL",
] as const;
export type BannerTarget = (typeof bannerTargets)[number];
export interface BannerInput {
  titleRu: string;
  titleUz: string;
  subtitleRu: string | null;
  subtitleUz: string | null;
  buttonRu: string | null;
  buttonUz: string | null;
  targetType: BannerTarget;
  targetCategoryId: string | null;
  targetProductId: string | null;
  targetUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}
export interface PublicBanner {
  id: string;
  titleRu: string;
  titleUz: string;
  subtitleRu: string | null;
  subtitleUz: string | null;
  buttonRu: string | null;
  buttonUz: string | null;
  imageUrl: string;
  href: string | null;
}
export interface AdminBanner extends BannerInput {
  id: string;
  imageUrl: string;
  createdAt: string;
  updatedAt: string;
}
