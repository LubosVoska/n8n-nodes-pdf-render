'use strict';
const path = require('path');

// Tests use this package's devDependencies as "the n8n copy" of pdf.js.
process.env.PDF_RENDER_PDFJS_DIR = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist');

// TEST-ONLY: pdfjs-dist 6 requires Node >= 22.13 (n8n 2.47 runs on it). This lets the tests also run on
// a Node 20 development machine; production code does not polyfill anything.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new this((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
if (typeof ArrayBuffer.prototype.transferToFixedLength !== 'function') {
  // copies instead of detaching, which is enough for pdf.js in tests
  ArrayBuffer.prototype.transferToFixedLength = function transferToFixedLength(length = this.byteLength) {
    const out = new ArrayBuffer(length);
    new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(length, this.byteLength)));
    return out;
  };
}

// Minimal PDF with A4 pages. Each page has text in Helvetica (a standard font that is NOT embedded, so
// pdf.js loads standard_fonts and, with disableFontFace, draws the glyphs as Path2D) and a stroked
// table frame (path operators), like the supplier confirmations that failed.
function makePdf(pageTexts) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };

  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const text of pageTexts) {
    const content = [
      'BT /F1 28 Tf 60 760 Td (' + text.replace(/[()\\]/g, '\\$&') + ') Tj ET',
      '2 w 50 600 495 120 re S',
      '50 660 m 545 660 l S',
      'BT /F1 14 Tf 60 680 Td (2520000  Zamok  2,000 BAL  8,08) Tj ET',
    ].join('\n');
    const stream = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// Count of dark pixels in a PNG region, decoded with the same canvas library the renderer uses.
async function darkPixels(png, region) {
  const canvas = require('@napi-rs/canvas');
  const img = await canvas.loadImage(png);
  const c = canvas.createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { x = 0, y = 0, w = img.width, h = img.height } = region || {};
  const { data } = ctx.getImageData(x, y, w, h);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) dark++;
  return dark;
}

module.exports = { makePdf, darkPixels };
