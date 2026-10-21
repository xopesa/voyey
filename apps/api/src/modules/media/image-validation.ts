import type { AllowedImageMimeType } from "./types.js";
import { validImageStructure } from "./image-structure.js";
import {
  ImageTooLargeError,
  ImageTypeMismatchError,
  UnsupportedImageTypeError,
} from "./errors.js";

export const imageExtensionByMimeType: Record<AllowedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function startsWith(data: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => data[index] === byte);
}

export function detectImageMimeType(data: Buffer): AllowedImageMimeType | null {
  if (data.length >= 3 && startsWith(data, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    data.length >= 8 &&
    startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image/png";
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("latin1") === "RIFF" &&
    data.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateImageUpload(
  data: Buffer,
  declaredMimeType: string,
  maxUploadBytes: number,
): AllowedImageMimeType {
  if (data.length > maxUploadBytes)
    throw new ImageTooLargeError(maxUploadBytes);
  if (!(declaredMimeType in imageExtensionByMimeType)) {
    throw new UnsupportedImageTypeError();
  }
  const detectedMimeType = detectImageMimeType(data);
  if (
    !detectedMimeType ||
    detectedMimeType !== declaredMimeType ||
    !validImageStructure(data, detectedMimeType)
  ) {
    throw new ImageTypeMismatchError();
  }
  return detectedMimeType;
}
