/* ==========================================================================
   NeutronZip — minimal ZIP writer (stored method, no compression).
   Standalone: no modules, no dependencies. Loaded via a plain <script> tag
   before app.js; also require()able in Node for tests.

   createStoredZip(files) -> Blob (browser) / Buffer-backed Blob (Node 18+)
   files: [{ name: "relative/path.ext", data: string | Uint8Array }]

   Filenames are UTF-8 (flag bit 11). CRC32 is computed per entry. The
   output is a valid ZIP readable by any unzip tool; verified by round-
   tripping through the server's ZIP reader in tests/chat-workspace.test.ts.
   ========================================================================== */
(function (root) {
  "use strict";

  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    var t = new Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    CRC_TABLE = t;
    return t;
  }

  function crc32(bytes) {
    var t = crcTable();
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    // Node fallback (TextEncoder exists in Node 18+, this is belt & braces).
    var buf = Buffer.from(str, "utf8");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  function toBytes(data) {
    if (typeof data === "string") return utf8Bytes(data);
    if (data instanceof Uint8Array) return data;
    throw new Error("NeutronZip: file data must be a string or Uint8Array");
  }

  function writeU16(view, off, v) { view.setUint16(off, v, true); }
  function writeU32(view, off, v) { view.setUint32(off, v, true); }

  function sanitizeName(name) {
    var p = String(name || "").replace(/\\/g, "/").trim();
    var parts = p.split("/").filter(function (s) { return s !== "" && s !== "." && s !== ".."; });
    return parts.join("/");
  }

  function createStoredZip(files) {
    if (!Array.isArray(files) || !files.length) throw new Error("NeutronZip: no files given");
    var entries = [];
    var chunks = [];
    var offset = 0;

    files.forEach(function (f, i) {
      var name = sanitizeName(f && f.name);
      if (!name) throw new Error("NeutronZip: file #" + i + " has an unsafe name");
      var data = toBytes(f.data);
      var nameBytes = utf8Bytes(name);
      var crc = crc32(data);

      // Local file header (30 bytes + name).
      var lh = new DataView(new ArrayBuffer(30));
      writeU32(lh, 0, 0x04034b50);
      writeU16(lh, 4, 20);          // version needed
      writeU16(lh, 6, 0x0800);      // flags: UTF-8 filenames
      writeU16(lh, 8, 0);           // method: stored
      writeU16(lh, 10, 0); writeU16(lh, 12, 0); // time/date (unset)
      writeU32(lh, 14, crc);
      writeU32(lh, 18, data.length);
      writeU32(lh, 22, data.length);
      writeU16(lh, 26, nameBytes.length);
      writeU16(lh, 28, 0);          // extra length

      chunks.push(new Uint8Array(lh.buffer), nameBytes, data);
      entries.push({ nameBytes: nameBytes, crc: crc, size: data.length, headerOffset: offset });
      offset += 30 + nameBytes.length + data.length;
    });

    // Central directory.
    var centralStart = offset;
    var centralChunks = [];
    entries.forEach(function (e) {
      var ch = new DataView(new ArrayBuffer(46));
      writeU32(ch, 0, 0x02014b50);
      writeU16(ch, 4, 20); writeU16(ch, 6, 20);
      writeU16(ch, 8, 0x0800);      // flags: UTF-8 filenames
      writeU16(ch, 10, 0);          // method: stored
      writeU16(ch, 12, 0); writeU16(ch, 14, 0); // time/date (unset)
      writeU32(ch, 16, e.crc);
      writeU32(ch, 20, e.size);
      writeU32(ch, 24, e.size);
      writeU16(ch, 28, e.nameBytes.length);
      writeU16(ch, 30, 0); writeU16(ch, 32, 0); // extra, comment
      writeU16(ch, 34, 0); writeU16(ch, 36, 0); // disk, attrs
      writeU32(ch, 38, 0);
      writeU32(ch, 42, e.headerOffset);
      centralChunks.push(new Uint8Array(ch.buffer), e.nameBytes);
      offset += 46 + e.nameBytes.length;
    });
    var centralSize = offset - centralStart;

    // End of central directory (22 bytes).
    var eocd = new DataView(new ArrayBuffer(22));
    writeU32(eocd, 0, 0x06054b50);
    writeU16(eocd, 4, 0); writeU16(eocd, 6, 0);
    writeU16(eocd, 8, entries.length);
    writeU16(eocd, 10, entries.length);
    writeU32(eocd, 12, centralSize);
    writeU32(eocd, 16, centralStart);
    writeU16(eocd, 20, 0);

    var all = chunks.concat(centralChunks);
    all.push(new Uint8Array(eocd.buffer));
    var total = 0;
    all.forEach(function (c) { total += c.length; });
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (c) { out.set(c, pos); pos += c.length; });

    if (typeof Blob !== "undefined") return new Blob([out], { type: "application/zip" });
    return out; // non-browser fallback (tests use arrayBuffer on the Blob)
  }

  var api = { createStoredZip: createStoredZip, _crc32: crc32 };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.NeutronZip = api;
  }
})(typeof self !== "undefined" ? self : this);
