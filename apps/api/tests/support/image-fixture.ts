import sharp from 'sharp';

export function pngChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  // PNG CRC-32 covers type and data, not the length.
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, data.length + 8)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return chunk;
}

export async function animatedPngFixture() {
  const png = Buffer.from(await (await imageFixture()).arrayBuffer());
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(1); // one animated frame, loop forever
  const frame = Buffer.alloc(26);
  frame.writeUInt32BE(32, 4);
  frame.writeUInt32BE(24, 8);
  frame.writeUInt16BE(1, 20);
  frame.writeUInt16BE(10, 22);
  const headerEnd = 8 + 12 + png.readUInt32BE(8);
  return new Blob([
    new Uint8Array(
      Buffer.concat([
        png.subarray(0, headerEnd),
        pngChunk('acTL', animation),
        pngChunk('fcTL', frame),
        png.subarray(headerEnd),
      ]),
    ),
  ]);
}

export async function imageFixture(format: 'jpeg' | 'png' | 'webp' = 'png', color = '#3155d9') {
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: color } })
    .toFormat(format)
    .toBuffer();
  return new File([new Uint8Array(bytes)], 'private-original-name.' + format, {
    type: 'image/' + format,
  });
}

export async function gifFixture() {
  const frames = await Promise.all(
    ['#3155d9', '#f97316'].map(async (color) =>
      Buffer.from(await (await imageFixture('png', color)).arrayBuffer()),
    ),
  );
  const bytes = await sharp(frames, { join: { animated: true } })
    .gif({ loop: 0, delay: [180, 240] })
    .toBuffer();
  return new File([new Uint8Array(bytes)], 'avatar.gif', { type: 'image/gif' });
}
