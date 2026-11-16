'use strict';
// Reproduces the n8n 2.47 failure: another canvas copy (here 0.1.100, the one in
// @bitovi/n8n-nodes-pdf-to-png) has set the pdf.js globals before our pdf.js loads. Drawing pdf.js paths
// from that copy into our canvas fails with "Value is none of these types `String`, `Path`"; the renderer
// must swap in its own globals while it renders and restore the foreign ones afterwards.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePdf, darkPixels } = require('./helpers');

const old = require('canvas-old');
globalThis.Path2D = old.Path2D;
globalThis.DOMMatrix = old.DOMMatrix;
globalThis.ImageData = old.ImageData;

const { renderPdf } = require('../lib/render');

test('a foreign Path2D is rejected by the other canvas copy (the original error)', () => {
  const ours = require('@napi-rs/canvas');
  const ctx = ours.createCanvas(10, 10).getContext('2d');
  assert.throws(() => ctx.fill(new old.Path2D('M0 0 L5 5 L0 5 Z')), /none of these types/);
});

test('renders despite foreign pdf.js globals and restores them afterwards', async () => {
  const result = await renderPdf(makePdf(['Potvrdenie KR100 270212']), { scale: 2 });
  assert.equal(result.pages.length, 1);
  assert.ok(await darkPixels(result.pages[0].png, { x: 100, y: 110, w: 900, h: 80 }) > 2000, 'heading text is drawn');
  assert.equal(globalThis.Path2D, old.Path2D);
  assert.equal(globalThis.DOMMatrix, old.DOMMatrix);
  assert.equal(globalThis.ImageData, old.ImageData);
});

test('concurrent renders do not restore the globals too early', async () => {
  const pdf = makePdf(['A', 'B', 'C']);
  const results = await Promise.all([renderPdf(pdf, { scale: 1 }), renderPdf(pdf, { scale: 1 })]);
  assert.deepEqual(results.map((r) => r.pages.length), [3, 3]);
  assert.equal(globalThis.Path2D, old.Path2D);
});
