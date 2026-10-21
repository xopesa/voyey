import { describe, expect, it } from "vitest";
import { validateImageUpload } from "../src/modules/media/image-validation.js";
import {
  ImageTooLargeError,
  ImageTypeMismatchError,
  UnsupportedImageTypeError,
} from "../src/modules/media/errors.js";
import {
  png,
  jpeg,
  webp,
  webpLossless,
  jpegProgressive,
  webpAlpha,
  webpAnimated,
} from "./fixtures/images.js";

const maxBytes = 5 * 1024 * 1024;
const validate = (bytes: Buffer, mime = "image/png") =>
  validateImageUpload(bytes, mime, maxBytes);

// Fixture-only CRC writer deliberately uses the bitwise reference algorithm,
// independently of the table-based runtime implementation.
function pngChunk(type: string, payload: Buffer) {
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length);
  chunk.write(type, 4, "ascii");
  payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}
const signature = png.subarray(0, 8);
const ihdr = png.subarray(16, 29);
const idat = png.subarray(41, 53);
const pngFile = (header = ihdr, chunks = [pngChunk("IDAT", idat)]) =>
  Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    ...chunks,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
function pngSize(width: number, height: number) {
  const header = Buffer.from(ihdr);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  return pngFile(header);
}
function riff(...chunks: Buffer[]) {
  const body = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), size, body]);
}
function riffChunk(type: string, bytes: Buffer) {
  const header = Buffer.alloc(8);
  header.write(type, "ascii");
  header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([
    header,
    bytes,
    ...(bytes.length & 1 ? [Buffer.from([0])] : []),
  ]);
}
function extendedWebp(width = 1, height = 1) {
  const header = Buffer.alloc(10);
  header.writeUIntLE(width - 1, 4, 3);
  header.writeUIntLE(height - 1, 7, 3);
  return riff(riffChunk("VP8X", header), webp.subarray(12));
}
function jpegSize(width: number, height: number) {
  const bytes = Buffer.from(jpeg),
    sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
  bytes.writeUInt16BE(height, sof + 5);
  bytes.writeUInt16BE(width, sof + 7);
  return bytes;
}

describe("bounded upload image structure", () => {
  it.each([
    ["PNG", png, "image/png"],
    ["JPEG", jpeg, "image/jpeg"],
    ["lossy WebP", webp, "image/webp"],
    ["lossless WebP", webpLossless, "image/webp"],
    ["extended WebP", extendedWebp(), "image/webp"],
    ["progressive JPEG", jpegProgressive, "image/jpeg"],
    ["alpha WebP", webpAlpha, "image/webp"],
    ["animated WebP", webpAnimated, "image/webp"],
  ])("accepts a real tiny %s fixture", (_name, bytes, mime) => {
    expect(validate(bytes as Buffer, mime as string)).toBe(mime);
  });

  it.each([
    ["PNG signature only", signature],
    ["PNG truncated after IHDR", png.subarray(0, 33)],
    ["PNG without IDAT", pngFile(ihdr, [])],
    [
      "PNG chunk beyond bounds",
      Buffer.concat([
        png.subarray(0, 33),
        Buffer.from("ffffffff49444154", "hex"),
      ]),
    ],
    [
      "PNG wrong first chunk",
      Buffer.concat([signature, pngChunk("IDAT", idat), png.subarray(8)]),
    ],
    ["PNG missing IEND", png.subarray(0, -12)],
    ["PNG trailing bytes", Buffer.concat([png, Buffer.from([0])])],
    [
      "PNG non-contiguous IDAT",
      pngFile(ihdr, [
        pngChunk("IDAT", idat),
        pngChunk("tEXt", Buffer.from("k\0v")),
        pngChunk("IDAT", idat),
      ]),
    ],
    [
      "PNG duplicate IHDR",
      pngFile(ihdr, [pngChunk("IHDR", ihdr), pngChunk("IDAT", idat)]),
    ],
    ["empty file", Buffer.alloc(0)],
  ])("rejects %s", (_name, bytes) => {
    expect(() => validate(bytes as Buffer)).toThrow(ImageTypeMismatchError);
  });

  it("rejects corrupted PNG CRC, even when its container lengths are intact", () => {
    const bytes = Buffer.from(png);
    bytes[45] = bytes[45]! ^ 1;
    expect(() => validate(bytes)).toThrow(ImageTypeMismatchError);
  });
  it("accepts consecutive split IDAT and bounded ancillary chunks with correct CRC", () => {
    const bytes = pngFile(ihdr, [
      pngChunk("tEXt", Buffer.from("k\0v")),
      pngChunk("IDAT", idat.subarray(0, 1)),
      pngChunk("IDAT", idat.subarray(1)),
    ]);
    expect(validate(bytes)).toBe("image/png");
  });
  it("rejects invalid IHDR format and zlib header", () => {
    for (const index of [8, 9, 10, 11, 12]) {
      const header = Buffer.from(ihdr);
      header[index] = 255;
      expect(() => validate(pngFile(header))).toThrow(ImageTypeMismatchError);
    }
    expect(() =>
      validate(pngFile(ihdr, [pngChunk("IDAT", Buffer.alloc(12))])),
    ).toThrow(ImageTypeMismatchError);
  });

  it.each([
    ["JPEG prefix only", Buffer.from([0xff, 0xd8, 0xff])],
    ["JPEG truncated segment", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0])],
    [
      "JPEG invalid segment length",
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0xff, 0xd9]),
    ],
    ["JPEG missing EOI", jpeg.subarray(0, -2)],
    ["JPEG missing frame and scan", Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ["JPEG trailing bytes", Buffer.concat([jpeg, Buffer.from([0])])],
  ])("rejects %s", (_name, bytes) => {
    expect(() => validate(bytes as Buffer, "image/jpeg")).toThrow(
      ImageTypeMismatchError,
    );
  });

  it.each([
    ["WebP prefix only", Buffer.from("524946460400000057454250", "hex")],
    ["WebP truncated chunk", webp.subarray(0, -1)],
    ["WebP missing bitmap", riff(riffChunk("VP8X", Buffer.alloc(10)))],
    ["WebP mismatched canvas", extendedWebp(2, 1)],
    [
      "WebP empty lossless bitstream",
      riff(riffChunk("VP8L", webpLossless.subarray(20, 25))),
    ],
  ])("rejects %s", (_name, bytes) => {
    expect(() => validate(bytes as Buffer, "image/webp")).toThrow(
      ImageTypeMismatchError,
    );
  });
  it("rejects WebP RIFF size, padding, frame signature, partition length and version corruption", () => {
    const badSize = Buffer.from(webp);
    badSize.writeUInt32LE(999, 4);
    const badPadding = Buffer.from(webpLossless);
    badPadding[badPadding.length - 1] = 1;
    const badFrame = Buffer.from(webp);
    badFrame[23] = 0;
    const badPartition = Buffer.from(webp);
    badPartition[22] = 255;
    const badVersion = Buffer.from(webpLossless);
    badVersion[24] = 0xe0;
    for (const bytes of [
      badSize,
      badPadding,
      badFrame,
      badPartition,
      badVersion,
    ])
      expect(() => validate(bytes, "image/webp")).toThrow(
        ImageTypeMismatchError,
      );
  });

  it.each([
    [0, 1],
    [1, 0],
    [10001, 1],
    [1, 10001],
    [8000, 8000],
  ])(
    "rejects bounded-invalid dimensions %sx%s in PNG/JPEG/WebP",
    (width, height) => {
      expect(() => validate(pngSize(width, height))).toThrow(
        ImageTypeMismatchError,
      );
      expect(() => validate(jpegSize(width, height), "image/jpeg")).toThrow(
        ImageTypeMismatchError,
      );
      const bytes = Buffer.from(webp);
      bytes.writeUInt16LE(width, 26);
      bytes.writeUInt16LE(height, 28);
      expect(() => validate(bytes, "image/webp")).toThrow(
        ImageTypeMismatchError,
      );
      if (width && height)
        expect(() =>
          validate(extendedWebp(width, height), "image/webp"),
        ).toThrow(ImageTypeMismatchError);
    },
  );
  it("allows ordinary phone-sized metadata within the explicit 50 MP limit", () => {
    expect(validate(pngSize(8000, 6000))).toBe("image/png");
  });
  it("rejects each incomplete prefix of the valid fixtures without parser exceptions", () => {
    for (const [bytes, mime] of [
      [png, "image/png"],
      [jpeg, "image/jpeg"],
      [webp, "image/webp"],
      [webpLossless, "image/webp"],
    ] as const)
      for (let size = 0; size < bytes.length; size++)
        expect(() => validate(bytes.subarray(0, size), mime)).toThrow(
          ImageTypeMismatchError,
        );
  });
  it("enforces MIME matching, unsupported types and the existing byte limit before parsing", () => {
    expect(() => validate(png, "image/jpeg")).toThrow(ImageTypeMismatchError);
    expect(() => validate(png, "image/svg+xml")).toThrow(
      UnsupportedImageTypeError,
    );
    expect(() => validate(Buffer.alloc(maxBytes + 1))).toThrow(
      ImageTooLargeError,
    );
    expect(validateImageUpload(png, "image/png", png.length)).toBe("image/png");
  });
  it("bounds chunk traversal without allocating from untrusted chunk sizes", () => {
    const many = Array.from({ length: 4096 }, () =>
      pngChunk("tEXt", Buffer.alloc(0)),
    );
    expect(() =>
      validate(pngFile(ihdr, [...many, pngChunk("IDAT", idat)])),
    ).toThrow(ImageTypeMismatchError);
  });
});
