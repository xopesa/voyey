import type { AllowedImageMimeType } from "./types.js";

// Bounded container validation, not pixel/entropy decoding. No native codecs,
// decompression, filesystem or external services run on the upload path.
// 50 MP accommodates ordinary phone photos under the existing 5 MiB byte cap.
const MAX_SIDE = 10_000;
const MAX_PIXELS = 50_000_000;
const MAX_PARTS = 4096;
function dimensions(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_SIDE &&
    height <= MAX_SIDE &&
    width * height <= MAX_PIXELS
  );
}

// PNG chunk layout and CRC: https://www.w3.org/TR/png-3/#5Chunk-layout
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc(data: Buffer, start: number, end: number): number {
  let value = 0xffffffff;
  for (let i = start; i < end; i++)
    value = crcTable[(value ^ data[i]!) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function png(data: Buffer): boolean {
  let offset = 8,
    parts = 0,
    color = -1,
    depth = 0,
    palette = false;
  let dataBytes = 0,
    dataStarted = false,
    dataEnded = false;
  const zlib: number[] = [];
  while (offset + 12 <= data.length && ++parts <= MAX_PARTS) {
    const length = data.readUInt32BE(offset),
      start = offset + 8,
      end = start + length;
    if (end + 4 > data.length) return false;
    const type = data.toString("latin1", offset + 4, start);
    // The third chunk-type byte is reserved and must be uppercase.
    if (
      !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) ||
      crc(data, offset + 4, end) !== data.readUInt32BE(end)
    )
      return false;
    if (parts === 1 && type !== "IHDR") return false;
    if (type === "IHDR") {
      if (
        parts !== 1 ||
        length !== 13 ||
        !dimensions(data.readUInt32BE(start), data.readUInt32BE(start + 4))
      )
        return false;
      depth = data[start + 8]!;
      color = data[start + 9]!;
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !depths[color]?.includes(depth) ||
        data[start + 10] !== 0 ||
        data[start + 11] !== 0 ||
        data[start + 12]! > 1
      )
        return false;
    } else if (type === "PLTE") {
      if (
        palette ||
        dataStarted ||
        color === 0 ||
        color === 4 ||
        length === 0 ||
        length % 3 !== 0 ||
        length > 768 ||
        (color === 3 && length / 3 > 2 ** depth)
      )
        return false;
      palette = true;
    } else if (type === "IDAT") {
      if (dataEnded || (color === 3 && !palette)) return false;
      dataStarted = true;
      dataBytes += length;
      for (let i = start; i < end && zlib.length < 2; i++) zlib.push(data[i]!);
    } else if (type === "IEND") {
      return (
        length === 0 &&
        end + 4 === data.length &&
        dataBytes > 6 &&
        (zlib[0]! & 15) === 8 &&
        zlib[0]! >>> 4 <= 7 &&
        ((zlib[0]! << 8) + zlib[1]!) % 31 === 0 &&
        (zlib[1]! & 32) === 0
      );
    } else if (type[0] === type[0]!.toUpperCase()) return false;
    if (dataStarted && type !== "IDAT") dataEnded = true;
    offset = end + 4;
  }
  return false;
}

// JPEG marker/segment and entropy framing: ITU-T T.81, Annex B.
// https://www.w3.org/Graphics/JPEG/itu-t81.pdf
function jpeg(data: Buffer): boolean {
  let offset = 2,
    parts = 0,
    frame = false,
    scans = 0,
    entropyBytes = 0;
  const components = new Set<number>();
  while (offset < data.length && ++parts <= MAX_PARTS) {
    if (data[offset++] !== 0xff) return false;
    while (data[offset] === 0xff) offset++;
    if (offset >= data.length) return false;
    const marker = data[offset++]!;
    if (marker === 0xd9)
      return frame && scans > 0 && entropyBytes > 0 && offset === data.length;
    if (marker === 0x01) continue; // Standalone TEM marker.
    if (marker < 0xc0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
      return false;
    if (offset + 2 > data.length) return false;
    const length = data.readUInt16BE(offset),
      start = offset + 2,
      end = offset + length;
    if (length < 2 || end > data.length) return false;
    const sof =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) {
      if (frame || length < 8) return false;
      const count = data[start + 5]!;
      if (
        count < 1 ||
        count > 4 ||
        length !== 8 + 3 * count ||
        data[start]! < 1 ||
        data[start]! > 16 ||
        !dimensions(data.readUInt16BE(start + 3), data.readUInt16BE(start + 1))
      )
        return false;
      for (let i = start + 6; i < end; i += 3) {
        const sampling = data[i + 1]!;
        if (
          components.has(data[i]!) ||
          sampling >> 4 < 1 ||
          sampling >> 4 > 4 ||
          (sampling & 15) < 1 ||
          (sampling & 15) > 4 ||
          data[i + 2]! > 3
        )
          return false;
        components.add(data[i]!);
      }
      frame = true;
    }
    offset = end;
    if (marker === 0xda) {
      if (!frame || length < 6) return false;
      const count = data[start]!;
      if (count < 1 || count > components.size || length !== 6 + 2 * count)
        return false;
      const scanComponents = new Set<number>();
      for (let i = start + 1; i < end - 3; i += 2) {
        if (
          !components.has(data[i]!) ||
          scanComponents.has(data[i]!) ||
          data[i + 1]! >> 4 > 3 ||
          (data[i + 1]! & 15) > 3
        )
          return false;
        scanComponents.add(data[i]!);
      }
      scans++;
      let scanBytes = 0;
      while (offset < data.length) {
        if (data[offset] !== 0xff) {
          offset++;
          scanBytes++;
          continue;
        }
        const markerStart = offset++;
        while (data[offset] === 0xff) offset++;
        if (offset >= data.length) return false;
        const next = data[offset]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          offset++;
          if (next === 0x00) scanBytes++;
          continue;
        }
        offset = markerStart;
        break;
      }
      if (!scanBytes) return false;
      entropyBytes += scanBytes;
    }
  }
  return false;
}

type Size = { width: number; height: number };
// WebP container and bitstream headers (no entropy decoding):
// https://developers.google.com/speed/webp/docs/riff_container
function webpBitmap(
  data: Buffer,
  type: string,
  start: number,
  end: number,
): Size | null {
  let width: number, height: number;
  if (type === "VP8 ") {
    if (end - start <= 10) return null;
    const tag = data.readUIntLE(start, 3);
    if (
      tag & 1 ||
      ((tag >> 1) & 7) > 3 ||
      !(tag & 16) ||
      tag >>> 5 === 0 ||
      tag >>> 5 > end - start - 10 ||
      data[start + 3] !== 0x9d ||
      data[start + 4] !== 1 ||
      data[start + 5] !== 0x2a
    )
      return null;
    width = data.readUInt16LE(start + 6) & 0x3fff;
    height = data.readUInt16LE(start + 8) & 0x3fff;
  } else {
    if (end - start <= 5 || data[start] !== 0x2f) return null;
    const bits = data.readUInt32LE(start + 1);
    if (bits >>> 29) return null; // VP8L version must be zero.
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  }
  return dimensions(width, height) ? { width, height } : null;
}
function webp(data: Buffer): boolean {
  if (data.length < 20 || data.readUInt32LE(4) + 8 !== data.length)
    return false;
  let offset = 12,
    parts = 0,
    canvas: Size | null = null,
    bitmap: Size | null = null;
  let animated = false,
    animationHeader = false,
    frames = 0,
    alpha = false;
  while (offset + 8 <= data.length && ++parts <= MAX_PARTS) {
    const type = data.toString("latin1", offset, offset + 4);
    const length = data.readUInt32LE(offset + 4),
      start = offset + 8,
      end = start + length;
    const next = end + (length & 1);
    if (next > data.length || (length & 1 && data[end] !== 0)) return false;
    if (type === "VP8X") {
      if (
        offset !== 12 ||
        length !== 10 ||
        data[start]! & 0xc1 ||
        data[start + 1] ||
        data[start + 2] ||
        data[start + 3]
      )
        return false;
      canvas = {
        width: data.readUIntLE(start + 4, 3) + 1,
        height: data.readUIntLE(start + 7, 3) + 1,
      };
      if (!dimensions(canvas.width, canvas.height)) return false;
      animated = !!(data[start]! & 2);
    } else if (type === "VP8 " || type === "VP8L") {
      if (bitmap || animated || (alpha && type === "VP8L")) return false;
      bitmap = webpBitmap(data, type, start, end);
      if (!bitmap) return false;
    } else if (type === "ALPH") {
      if (
        !canvas ||
        animated ||
        alpha ||
        bitmap ||
        length <= 1 ||
        data[start]! & 0xc0 ||
        (data[start]! & 3) > 1 ||
        ((data[start]! >> 4) & 3) > 1
      )
        return false;
      if (
        (data[start]! & 3) === 0 &&
        length !== 1 + canvas.width * canvas.height
      )
        return false;
      alpha = true;
    } else if (type === "ANIM") {
      if (!animated || animationHeader || frames || length !== 6) return false;
      animationHeader = true;
    } else if (type === "ANMF") {
      if (
        !canvas ||
        !animated ||
        !animationHeader ||
        length <= 16 ||
        data[start + 15]! & 0xfc
      )
        return false;
      const width = data.readUIntLE(start + 6, 3) + 1,
        height = data.readUIntLE(start + 9, 3) + 1;
      if (
        !dimensions(width, height) ||
        data.readUIntLE(start, 3) * 2 + width > canvas.width ||
        data.readUIntLE(start + 3, 3) * 2 + height > canvas.height
      )
        return false;
      let sub = start + 16,
        frameBitmap = false,
        frameAlpha = false;
      while (sub + 8 <= end && ++parts <= MAX_PARTS) {
        const kind = data.toString("latin1", sub, sub + 4),
          size = data.readUInt32LE(sub + 4);
        const payload = sub + 8,
          finish = payload + size,
          padded = finish + (size & 1);
        if (padded > end || (size & 1 && data[finish] !== 0)) return false;
        if (kind === "VP8 " || kind === "VP8L") {
          if (frameBitmap || (frameAlpha && kind === "VP8L")) return false;
          const frame = webpBitmap(data, kind, payload, finish);
          if (!frame || frame.width !== width || frame.height !== height)
            return false;
          frameBitmap = true;
        } else if (kind === "ALPH") {
          if (
            frameAlpha ||
            frameBitmap ||
            size <= 1 ||
            data[payload]! & 0xc0 ||
            (data[payload]! & 3) > 1 ||
            ((data[payload]! >> 4) & 3) > 1 ||
            ((data[payload]! & 3) === 0 && size !== 1 + width * height)
          )
            return false;
          frameAlpha = true;
        } else if (["VP8X", "ANIM", "ANMF"].includes(kind)) return false;
        sub = padded;
      }
      if (sub !== end || !frameBitmap) return false;
      frames++;
    } else if (["ICCP", "EXIF", "XMP "].includes(type) && !canvas) return false;
    offset = next;
  }
  if (offset !== data.length || parts > MAX_PARTS) return false;
  if (animated) return animationHeader && frames > 0;
  return (
    !!bitmap &&
    (!canvas ||
      (bitmap.width === canvas.width && bitmap.height === canvas.height))
  );
}

export function validImageStructure(
  data: Buffer,
  mime: AllowedImageMimeType,
): boolean {
  switch (mime) {
    case "image/png":
      return png(data);
    case "image/jpeg":
      return jpeg(data);
    case "image/webp":
      return webp(data);
  }
}
