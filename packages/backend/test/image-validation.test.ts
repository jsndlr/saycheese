import { MAX_EDGE, MAX_UPLOAD_BYTES } from "@saycheese/core/limits";
import sharp from "sharp";
import { expect, it } from "vitest";
import { deflateSync } from "node:zlib";

import { validateImage } from "../convex/lib/imageValidation";

/**
 * Fixtures are generated here on purpose: no binary blobs are committed, and
 * every crafted file is a few dozen bytes. The tests live in the Node project
 * because validation imports sharp.
 */

const JPEG = "image/jpeg";
const PNG = "image/png";
const WEBP = "image/webp";

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * A PNG whose IHDR claims `width x height` but which carries exactly one
 * compressed zeroed scanline (plus IEND). No real pixel grid exists; a 15000 x
 * 15000 claim still produces a file under 200 bytes.
 *
 * sharp/libvips cannot read metadata from an IHDR-only PNG ("corrupt header"),
 * so one scanline is the smallest body that lets the header read succeed. The
 * point of the fixture is that a header claiming 225 MP is rejected from the
 * header alone, before any full decode.
 */
function craftedPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const scanline = Buffer.alloc(1 + width * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanline)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * A minimal ISO-BMFF `ftyp` box: size, `ftyp`, major brand, minor version,
 * then compatible brands. Enough for magic-byte sniffing; no image items.
 */
function heifFtyp(majorBrand: string, compatibleBrands: string[]): Buffer {
  const bytes = Buffer.alloc(16 + compatibleBrands.length * 4);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write(majorBrand, 8, "ascii");
  bytes.writeUInt32BE(0, 12);
  compatibleBrands.forEach((brand, index) => {
    bytes.write(brand, 16 + index * 4, "ascii");
  });
  return bytes;
}

/**
 * A two-frame APNG header: signature, IHDR, `acTL` (2 frames), one IDAT, IEND.
 * No fcTL/fdAT frames exist, but the animation chunk is what the sniffer and
 * the upload policy key on.
 */
function craftedApng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  const animationControl = Buffer.alloc(8);
  animationControl.writeUInt32BE(2, 0); // num_frames
  animationControl.writeUInt32BE(0, 4); // num_plays
  const scanline = Buffer.alloc(1 + width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("acTL", animationControl),
    pngChunk("IDAT", deflateSync(scanline)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function solidJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  })
    .jpeg()
    .toBuffer();
}

it("T-IMG-05 rejects a body over the byte cap before sniffing", async () => {
  // The declared MIME and magic bytes are irrelevant; the cap wins first.
  const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  bytes.set([0xff, 0xd8, 0xff], 0);

  const result = await validateImage(bytes, JPEG);

  expect(result).toEqual({ ok: false, code: "PAYLOAD_TOO_LARGE" });
});

it("T-IMG-06 trusts magic bytes, not the declared MIME", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  const png = await solidPng(64, 64);
  const jpeg = await solidJpeg(64, 64);

  expect(await validateImage(pdf, JPEG)).toEqual({
    ok: false,
    code: "UNSUPPORTED_MEDIA_TYPE",
  });
  expect(await validateImage(svg, "image/svg+xml")).toEqual({
    ok: false,
    code: "UNSUPPORTED_MEDIA_TYPE",
  });
  // Real PNG content behind an image/jpeg declaration is still refused.
  expect(await validateImage(png, JPEG)).toEqual({
    ok: false,
    code: "UNSUPPORTED_MEDIA_TYPE",
  });

  const accepted = await validateImage(jpeg, JPEG);
  expect(accepted).toMatchObject({ ok: true, sniffedMime: JPEG, width: 64, height: 64, pages: 1 });
});

it("T-IMG-07 rejects oversized dimensions from the header, before decoding", async () => {
  const crafted = craftedPng(15000, 15000);
  // 225 MP of pixels would be ~675 MB; this file has one scanline and no grid.
  expect(crafted.length).toBeLessThan(1024);

  const oversized = await validateImage(crafted, PNG);
  // IMAGE_TOO_LARGE, not IMAGE_CORRUPT: the dimensions were inspected and
  // rejected without touching a pixel buffer.
  expect(oversized).toEqual({ ok: false, code: "IMAGE_TOO_LARGE" });

  const wide = await solidPng(MAX_EDGE + 808, 100); // 9000 x 100: edge rule.
  expect(await validateImage(wide, PNG)).toEqual({
    ok: false,
    code: "IMAGE_TOO_LARGE",
  });
});

it("T-IMG-08 rejects animated images", async () => {
  const frame = async (r: number, b: number) =>
    sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r, g: 0, b },
      },
    })
      .png()
      .toBuffer();

  const animated = await sharp([await frame(255, 0), await frame(0, 255)], {
    join: { animated: true },
  })
    .webp()
    .toBuffer();

  expect(await validateImage(animated, WEBP)).toEqual({
    ok: false,
    code: "ANIMATED_UNSUPPORTED",
  });
});

it("T-IMG-09 enforces the minimum edge and detects truncated or fake JPEGs", async () => {
  expect(await validateImage(await solidPng(1, 1), PNG)).toEqual({
    ok: false,
    code: "IMAGE_TOO_SMALL",
  });
  expect(await validateImage(await solidPng(63, 200), PNG)).toEqual({
    ok: false,
    code: "IMAGE_TOO_SMALL",
  });
  expect(await validateImage(await solidPng(64, 64), PNG)).toMatchObject({
    ok: true,
    width: 64,
    height: 64,
  });

  const jpeg = await solidJpeg(400, 300);
  const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 2));
  expect(await validateImage(truncated, JPEG)).toEqual({
    ok: false,
    code: "IMAGE_CORRUPT",
  });

  const fake = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from("not actually a jpeg body"),
  ]);
  expect(await validateImage(fake, JPEG)).toEqual({
    ok: false,
    code: "IMAGE_CORRUPT",
  });
});

it("T-IMG-10 reports HEIC/HEIF as HEIC_UNSUPPORTED regardless of declared type", async () => {
  const fixtures = [
    heifFtyp("heic", []), // iPhone-style major brand
    heifFtyp("mif1", ["heic"]), // generic HEIF major brand, HEIC compatible
  ];

  for (const bytes of fixtures) {
    for (const declared of ["image/heic", "image/jpeg"]) {
      expect(await validateImage(bytes, declared)).toEqual({
        ok: false,
        code: "HEIC_UNSUPPORTED",
      });
    }
  }
});

it("T-IMG-11 reports a two-frame APNG as animated, not unsupported", async () => {
  const apng = craftedApng(64, 64);
  expect(apng.length).toBeLessThan(1024);

  expect(await validateImage(apng, PNG)).toEqual({
    ok: false,
    code: "ANIMATED_UNSUPPORTED",
  });
});

it("accepts a JPEG/PHP polyglot: re-encoding in task 2 neutralises the payload", async () => {
  // Appending a script to a valid JPEG does not change its pixels and is not a
  // decode error. Task 1 only validates; task 2 re-encodes the decoded pixels,
  // which drops the trailing payload from the stored variant.
  const jpeg = await solidJpeg(400, 300);
  const polyglot = Buffer.concat([jpeg, Buffer.from("<?php echo 'pwn'; ?>")]);

  expect(await validateImage(polyglot, JPEG)).toMatchObject({
    ok: true,
    sniffedMime: JPEG,
    width: 400,
    height: 300,
  });
});