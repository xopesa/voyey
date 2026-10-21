export type AllowedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface StorageWriteInput {
  key: string;
  data: Buffer;
  contentType: AllowedImageMimeType;
}

export interface StorageProvider {
  upload(input: StorageWriteInput): Promise<void>;
  delete(key: string): Promise<void>;
  read(key: string): Promise<Buffer>;
}

export interface PublicStorageProvider extends StorageProvider {
  getPublicUrl(key: string): string;
}

export interface ImageUploadInput {
  data: Buffer;
  declaredMimeType: string;
}

export interface StoredImage {
  key: string;
  url: string;
  mimeType: AllowedImageMimeType;
  size: number;
}

export interface StoredPrivateImage {
  key: string;
  mimeType: AllowedImageMimeType;
  size: number;
}
