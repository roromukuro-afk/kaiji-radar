import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";

// CRC32 for PNG chunks
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(d.length);
  const crcIn = Buffer.concat([t, d]);
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(crcIn));
  return Buffer.concat([len, t, d, crc]);
}

function solidPng(width, height, r, g, b, a = 255) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Scanlines: filter byte + RGBA pixels
  const bpp = 4;
  const raw = Buffer.allocUnsafe(height * (1 + width * bpp));
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * bpp);
    raw[off] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * bpp;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }

  // Rounded-corner mask
  const corner = Math.floor(width * 0.2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Simple rounded rectangle: check corners
      const inCorner =
        (x < corner && y < corner && Math.sqrt((x - corner) ** 2 + (y - corner) ** 2) > corner) ||
        (x > width - corner - 1 && y < corner && Math.sqrt((x - (width - corner - 1)) ** 2 + (y - corner) ** 2) > corner) ||
        (x < corner && y > height - corner - 1 && Math.sqrt((x - corner) ** 2 + (y - (height - corner - 1)) ** 2) > corner) ||
        (x > width - corner - 1 && y > height - corner - 1 && Math.sqrt((x - (width - corner - 1)) ** 2 + (y - (height - corner - 1)) ** 2) > corner);
      if (inCorner) {
        const p = y * (1 + width * bpp) + 1 + x * bpp;
        raw[p + 3] = 0; // transparent
      }
    }
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });

// Background: dark slate #0f172a = rgb(15, 23, 42)
// Accent: vivid blue #3b82f6 = rgb(59, 130, 246)

const bg = [15, 23, 42];
const ac = [59, 130, 246];

// 192x192 icon — two-tone, simple "signal" design
function signalIcon(size) {
  const bpp = 4;
  const raw = Buffer.allocUnsafe(size * (1 + size * bpp));

  for (let y = 0; y < size; y++) {
    const off = y * (1 + size * bpp);
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * bpp;
      // Default: background color, transparent
      raw[p] = bg[0]; raw[p + 1] = bg[1]; raw[p + 2] = bg[2]; raw[p + 3] = 255;
    }
  }

  // Draw 3 signal bars in the center
  const barW = Math.floor(size * 0.1);
  const gap = Math.floor(size * 0.05);
  const totalW = barW * 3 + gap * 2;
  const startX = Math.floor((size - totalW) / 2);
  const baseY = Math.floor(size * 0.75);

  const barHeights = [size * 0.25, size * 0.4, size * 0.55];

  for (let b = 0; b < 3; b++) {
    const bx = startX + b * (barW + gap);
    const bh = Math.floor(barHeights[b]);
    const by = baseY - bh;
    const br = Math.floor(barW * 0.3);

    for (let y = by; y < baseY; y++) {
      for (let x = bx; x < bx + barW; x++) {
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        // Round top corners
        const isTopLeft = x - bx < br && y - by < br;
        const isTopRight = bx + barW - 1 - x < br && y - by < br;
        const inRound =
          (isTopLeft && Math.sqrt((x - (bx + br)) ** 2 + (y - (by + br)) ** 2) > br) ||
          (isTopRight && Math.sqrt((x - (bx + barW - 1 - br)) ** 2 + (y - (by + br)) ** 2) > br);
        if (!inRound) {
          const p = y * (1 + size * bpp) + 1 + x * bpp;
          raw[p] = ac[0]; raw[p + 1] = ac[1]; raw[p + 2] = ac[2]; raw[p + 3] = 255;
        }
      }
    }
  }

  // Rounded-corner mask on the full image
  const corner = Math.floor(size * 0.2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inCorner =
        (x < corner && y < corner && Math.sqrt((x - corner) ** 2 + (y - corner) ** 2) > corner) ||
        (x > size - corner - 1 && y < corner && Math.sqrt((x - (size - corner - 1)) ** 2 + (y - corner) ** 2) > corner) ||
        (x < corner && y > size - corner - 1 && Math.sqrt((x - corner) ** 2 + (y - (size - corner - 1)) ** 2) > corner) ||
        (x > size - corner - 1 && y > size - corner - 1 && Math.sqrt((x - (size - corner - 1)) ** 2 + (y - (size - corner - 1)) ** 2) > corner);
      if (inCorner) {
        const p = y * (1 + size * bpp) + 1 + x * bpp;
        raw[p + 3] = 0;
      }
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

// Icons
writeFileSync("public/icons/icon-192.png", signalIcon(192));
console.log("✓ icon-192.png");

writeFileSync("public/icons/icon-512.png", signalIcon(512));
console.log("✓ icon-512.png");

// Badge: solid circle on white for monochrome badge
writeFileSync("public/icons/badge-96.png", solidPng(96, 96, 15, 23, 42, 255));
console.log("✓ badge-96.png");

console.log("Done. Icons saved to public/icons/");
