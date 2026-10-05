import { InvalidImageError } from './errors';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// libvips can decode an APNG's default frame without reporting its animation metadata.
// Inspect chunk boundaries, not arbitrary byte matches inside compressed pixel data.
export function assertStaticPng(source: Buffer) {
  if (!source.subarray(0, 8).equals(signature)) return;
  let offset = 8;
  while (offset + 12 <= source.length) {
    const size = source.readUInt32BE(offset);
    const end = offset + size + 12;
    if (end > source.length) throw new InvalidImageError();
    const type = source.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') throw new InvalidImageError();
    if (type === 'IEND') return;
    offset = end;
  }
  throw new InvalidImageError();
}
