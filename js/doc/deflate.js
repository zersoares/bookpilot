// Compression, for both places the document engine runs.
//
// The engine is shared: the exporter runs it in a Netlify function, and
// the page previewer runs it in the browser. Node has zlib built in; a
// browser does not, and importing `node:zlib` from a module the browser
// loads fails the whole module graph before a single page is laid out.
//
// So compression is injected rather than imported. This file holds the
// universal fallback — a DEFLATE stream of stored blocks, which is a
// valid stream that happens not to compress. The server passes Node's
// real deflate in its place, so production files are small and the demo
// workspace still produces a correct, if larger, one.
//
// Stored blocks are defined in RFC 1951 §3.2.4: a 3-bit header, then the
// length and its complement, then the bytes.

const MAX_BLOCK = 65535;

/** Raw DEFLATE (RFC 1951), as stored blocks. What a ZIP entry wants. */
export function deflateRawStored(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const blocks = Math.max(1, Math.ceil(input.length / MAX_BLOCK));
  const out = new Uint8Array(input.length + blocks * 5);
  let at = 0;
  let offset = 0;

  do {
    const size = Math.min(MAX_BLOCK, input.length - offset);
    const last = offset + size >= input.length ? 1 : 0;
    out[at++] = last;                       // BFINAL, BTYPE=00
    out[at++] = size & 0xff;
    out[at++] = (size >>> 8) & 0xff;
    out[at++] = ~size & 0xff;
    out[at++] = (~size >>> 8) & 0xff;
    out.set(input.subarray(offset, offset + size), at);
    at += size;
    offset += size;
  } while (offset < input.length);

  return out.subarray(0, at);
}

/** Adler-32, the checksum a zlib stream ends with (RFC 1950). */
export function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib (RFC 1950), as stored blocks. What a PDF /FlateDecode wants. */
export function deflateZlibStored(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const body = deflateRawStored(input);
  const out = new Uint8Array(body.length + 6);
  // CMF: deflate, 32K window. FLG: no dictionary, and the two bytes read
  // as a big-endian multiple of 31.
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(body, 2);
  const sum = adler32(input);
  out[out.length - 4] = (sum >>> 24) & 0xff;
  out[out.length - 3] = (sum >>> 16) & 0xff;
  out[out.length - 2] = (sum >>> 8) & 0xff;
  out[out.length - 1] = sum & 0xff;
  return out;
}
