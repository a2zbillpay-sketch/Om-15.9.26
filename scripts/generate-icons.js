import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPNG(width, height, bgColor, text) {
  // Simple uncompressed or deflate PNG generator
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);

  // Parse bgColor #0F2C59
  const r = parseInt(bgColor.slice(1, 3), 16);
  const g = parseInt(bgColor.slice(3, 5), 16);
  const b = parseInt(bgColor.slice(5, 7), 16);

  // Gold border and accent #D4AF37
  const gr = 212, gg = 175, gb = 55;

  // Raw image data with 1 byte filter per line
  const rawData = Buffer.alloc(height * (width * 3 + 1));
  let pos = 0;

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = width * 0.42;
  const innerRadius = width * 0.38;

  for (let y = 0; y < height; y++) {
    rawData[pos++] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Gold circle ring
      if (dist <= radius && dist >= innerRadius) {
        rawData[pos++] = gr;
        rawData[pos++] = gg;
        rawData[pos++] = gb;
      } else if (dist < innerRadius) {
        // Inner circle pattern - draw stylized "OM" letters or deep navy
        // Simple geometric OM emblem
        const inCenterBox = Math.abs(dx) < width * 0.22 && Math.abs(dy) < height * 0.22;
        if (inCenterBox && (Math.abs(dx) > width * 0.15 || Math.abs(dy) > height * 0.15 || (Math.abs(dx) < width * 0.04 && Math.abs(dy) < height * 0.12))) {
          rawData[pos++] = gr;
          rawData[pos++] = gg;
          rawData[pos++] = gb;
        } else {
          rawData[pos++] = r;
          rawData[pos++] = g;
          rawData[pos++] = b;
        }
      } else {
        rawData[pos++] = r;
        rawData[pos++] = g;
        rawData[pos++] = b;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

const dir = path.join(process.cwd(), 'public', 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(path.join(dir, 'icon-192x192.png'), createPNG(192, 192, '#0F2C59', 'OM'));
fs.writeFileSync(path.join(dir, 'icon-512x512.png'), createPNG(512, 512, '#0F2C59', 'OM'));
console.log('Icons created successfully');
