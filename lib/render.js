'use strict';
const { loadLibs } = require('./pdfjs');

const MAX_CANVAS_PIXELS = 100000000; // same guard as pdf-to-png-converter
const VERBOSITY_ERRORS = 0;

// While this node renders, the pdf.js globals must come from the canvas library it draws with. Another
// PDF node loaded earlier in the process (e.g. @bitovi/n8n-nodes-pdf-to-png with its own canvas copy)
// may have set them from a different copy. Swap them in for the render and restore them afterwards;
// a depth counter keeps concurrent renders in one process from restoring too early.
const GLOBAL_NAMES = ['Path2D', 'DOMMatrix', 'ImageData', 'pdfjsWorker'];
let depth = 0;
let saved = null;

function enterGlobals(libs) {
  if (depth++ === 0) {
    saved = GLOBAL_NAMES.map((name) => [name, Object.prototype.hasOwnProperty.call(globalThis, name), globalThis[name]]);
  }
  const { canvas, worker } = libs;
  if (canvas.Path2D) globalThis.Path2D = canvas.Path2D;
  if (canvas.DOMMatrix) globalThis.DOMMatrix = canvas.DOMMatrix;
  if (canvas.ImageData) globalThis.ImageData = canvas.ImageData;
  if (worker && worker.WorkerMessageHandler) globalThis.pdfjsWorker = worker;
}

function leaveGlobals() {
  if (--depth > 0) return;
  for (const [name, had, value] of saved) {
    if (had) globalThis[name] = value;
    else delete globalThis[name];
  }
  saved = null;
}

// "1-3,5" -> [1, 2, 3, 5]; empty -> null (all pages). Invalid parts throw, so a typo is not silently
// ignored.
function parsePageRange(range) {
  const text = String(range ?? '').trim();
  if (!text) return null;
  const pages = new Set();
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`Invalid page range part "${part}"`);
    const start = Number(m[1]);
    const end = m[2] === undefined ? start : Number(m[2]);
    if (start < 1 || end < start) throw new Error(`Invalid page range part "${part}"`);
    for (let p = start; p <= end; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

// Renders a PDF (Buffer / Uint8Array) to PNG pages.
// Returns { numPages, pdfjsVersion, pages: [{ pageNumber, width, height, png }] }; pages outside the
// document are skipped.
async function renderPdf(pdfBytes, { scale = 2, pages = null } = {}) {
  if (!(scale > 0) || scale > 10) throw new Error(`Invalid scale ${scale}`);
  const libs = await loadLibs();
  const { pdfjs, canvas, assets } = libs;

  enterGlobals(libs);
  let task = null;
  try {
    task = pdfjs.getDocument({
      data: new Uint8Array(pdfBytes), // copy: pdf.js may detach the buffer it gets
      ...assets,
      cMapPacked: true,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: true,
      isEvalSupported: false,
      verbosity: VERBOSITY_ERRORS,
    });
    const doc = await task.promise;

    const numPages = doc.numPages;
    const wanted = (pages || Array.from({ length: numPages }, (_, i) => i + 1)).filter((p) => p >= 1 && p <= numPages);
    const out = [];
    for (const pageNumber of wanted) {
      const page = await doc.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        if (width * height > MAX_CANVAS_PIXELS) {
          throw new Error(`Page ${pageNumber}: canvas ${width}x${height} px exceeds ${MAX_CANVAS_PIXELS} pixels, lower the scale`);
        }
        const c = canvas.createCanvas(width, height);
        await page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport }).promise;
        out.push({ pageNumber, width, height, png: await c.encode('png') });
      } finally {
        page.cleanup();
      }
    }
    return { numPages, pdfjsVersion: libs.version, pages: out };
  } finally {
    try {
      // pdf.js 6: the loading task owns the document and its (fake) worker
      if (task) await task.destroy();
    } catch (e) {
      /* already destroyed or failed to load */
    } finally {
      leaveGlobals();
    }
  }
}

module.exports = { renderPdf, parsePageRange };
