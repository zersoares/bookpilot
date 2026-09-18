// A minimal ZIP writer.
//
// EPUB and DOCX are both ZIP containers, so one writer serves both. Node's
// zlib supplies the compression, which keeps this repository's "no
// dependencies" rule intact.
//
// Two details that are not optional:
//
//   * EPUB requires the `mimetype` entry to be first and STORED, not
//     deflated. Readers check the bytes at a fixed offset; a compressed
//     mimetype is the commonest reason a valid-looking EPUB is rejected.
//   * Every entry needs its CRC-32. A ZIP with a wrong CRC opens in some
//     tools and fails validation in the ones that matter.
//
// Compression is injected, for the same reason as in doc/pdf.js: this
// runs in the browser as well as on the server.

import { deflateRawStored } from "./deflate.js";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const ENCODER = new TextEncoder();

function toBytes(data) {
  if (typeof data === "string") return ENCODER.encode(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function dosDateTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

class Writer {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value) {
    this.push(Uint8Array.from([value & 255, (value >>> 8) & 255]));
  }

  u32(value) {
    this.push(Uint8Array.from([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]));
  }

  concat() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Build a ZIP.
 *
 * @param {Array<{name:string, data:string|Uint8Array, store?:boolean}>} entries
 * @param {Date} now
 * @param {object} options { deflate } — raw DEFLATE; defaults to stored blocks
 * @returns {Uint8Array}
 */
export function zip(entries, now = new Date(), options = {}) {
  const deflate = options.deflate || deflateRawStored;
  const out = new Writer();
  const central = [];
  const { time, day } = dosDateTime(now);

  for (const entry of entries) {
    const nameBytes = ENCODER.encode(entry.name);
    const raw = toBytes(entry.data);
    const store = Boolean(entry.store);
    const body = store ? raw : new Uint8Array(deflate(raw));
    const crc = crc32(raw);
    const offset = out.length;

    out.u32(0x04034b50);
    out.u16(store ? 10 : 20);      // version needed
    out.u16(0x0800);               // UTF-8 names
    out.u16(store ? 0 : 8);        // method
    out.u16(time);
    out.u16(day);
    out.u32(crc);
    out.u32(body.length);
    out.u32(raw.length);
    out.u16(nameBytes.length);
    out.u16(0);
    out.push(nameBytes);
    out.push(body);

    central.push({ nameBytes, crc, compressed: body.length, size: raw.length, offset, store });
  }

  const centralStart = out.length;
  for (const item of central) {
    out.u32(0x02014b50);
    out.u16(0x031e);               // made by: UNIX, version 3.0
    out.u16(item.store ? 10 : 20);
    out.u16(0x0800);
    out.u16(item.store ? 0 : 8);
    out.u16(time);
    out.u16(day);
    out.u32(item.crc);
    out.u32(item.compressed);
    out.u32(item.size);
    out.u16(item.nameBytes.length);
    out.u16(0);
    out.u16(0);
    out.u16(0);
    out.u16(0);
    out.u32(0);
    out.u32(item.offset);
    out.push(item.nameBytes);
  }
  const centralSize = out.length - centralStart;

  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(central.length);
  out.u16(central.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0);

  return out.concat();
}
