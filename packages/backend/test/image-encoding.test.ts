import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { expect, it } from "vitest";

import { encodeVariants } from "../convex/lib/imageEncoding";
import type { EncodedVariant } from "../convex/lib/imageEncoding";

/**
 * Re-encoding is the security boundary: whatever the upload carried beyond the
 * decoded pixels must not reach storage. Fixtures are generated with sharp so
 * no binary blobs are committed.
 */

const WEBP = "image/webp";

async function solidJpeg(width: number, height: number): Promise<Buffer> {
  return await sharp({
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

/** 300x200 stored grid, EXIF orientation 6, GPS and XMP attached. */
async function taggedJpeg(): Promise<Buffer> {
  return await sharp(await solidJpeg(300, 200))
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: "Saycheese", Model: "Probe" },
      // sharp 0.33+ exposes the GPS IFD as IFD3.
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "51/1 30/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "0/1 7/1 0/1",
      },
    })
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
    )
    .jpeg()
    .toBuffer();
}

function variantsOf(encoded: {
  variants: { original: EncodedVariant; preview: EncodedVariant; thumb: EncodedVariant };
}): EncodedVariant[] {
  return [
    encoded.variants.original,
    encoded.variants.preview,
    encoded.variants.thumb,
  ];
}

async function expectWebp(variant: EncodedVariant): Promise<void> {
  const sniffed = await fileTypeFromBuffer(variant.bytes);
  expect(sniffed?.mime).toBe(WEBP);
}

it("T-IMG-10 produces core-sized WebP variants and preserves the aspect ratio", async () => {
  const source = await solidJpeg(3000, 2000);
  const encoded = await encodeVariants(source);

  expect(encoded).toMatchObject({ width: 3000, height: 2000 });
  expect(encoded.variants.original.width).toBe(1600);
  expect(encoded.variants.preview.width).toBe(512);
  expect(encoded.variants.thumb.width).toBe(160);

  for (const variant of variantsOf(encoded)) {
    expect(variant.width / variant.height).toBeCloseTo(3000 / 2000, 2);
  }

  for (const variant of variantsOf(encoded)) {
    await expectWebp(variant);
  }
});

it("T-IMG-10 never enlarges a small source", async () => {
  const encoded = await encodeVariants(await solidJpeg(300, 200));

  expect(encoded).toMatchObject({ width: 300, height: 200 });
  expect(encoded.variants.original).toMatchObject({ width: 300, height: 200 });
  expect(encoded.variants.preview).toMatchObject({ width: 300, height: 200 });
  expect(encoded.variants.thumb).toMatchObject({ width: 160, height: 107 });

  for (const variant of variantsOf(encoded)) {
    await expectWebp(variant);
  }
});

it("T-IMG-10 applies EXIF orientation before resizing", async () => {
  const encoded = await encodeVariants(await taggedJpeg());

  // Stored pixel grid is 300x200; orientation 6 displays as 200x300.
  expect(encoded).toMatchObject({ width: 200, height: 300 });
  expect(encoded.variants.original).toMatchObject({ width: 200, height: 300 });
  expect(encoded.variants.preview).toMatchObject({ width: 200, height: 300 });
  expect(encoded.variants.thumb).toMatchObject({ width: 107, height: 160 });
});

it("T-SEC-01 drops EXIF, GPS and XMP from every output", async () => {
  const source = await taggedJpeg();
  const sourceMetadata = await sharp(source).metadata();
  // The fixture is only meaningful if the input actually carries the tags.
  expect(sourceMetadata.exif).toBeDefined();
  expect(sourceMetadata.exif?.includes(Buffer.from("Saycheese"))).toBe(true);
  // Little-endian TIFF: the GPSInfo IFD pointer tag 0x8825.
  expect(sourceMetadata.exif?.includes(Buffer.from([0x25, 0x88]))).toBe(true);
  expect(sourceMetadata.xmp).toBeDefined();

  const encoded = await encodeVariants(source);

  for (const variant of variantsOf(encoded)) {
    const metadata = await sharp(variant.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    // sharp 0.35 also drops the ICC profile unless metadata is requested.
    expect(metadata.icc).toBeUndefined();
  }
});

it("T-SEC-01 drops a trailing script payload from a JPEG/PHP polyglot", async () => {
  const polyglot = Buffer.concat([
    await solidJpeg(400, 300),
    Buffer.from("<?php echo 'pwn'; ?>"),
  ]);

  const encoded = await encodeVariants(polyglot);

  for (const variant of variantsOf(encoded)) {
    expect(variant.bytes.includes(Buffer.from("<?php"))).toBe(false);
    expect(variant.bytes.includes(Buffer.from("pwn"))).toBe(false);
    await expectWebp(variant);
  }
});