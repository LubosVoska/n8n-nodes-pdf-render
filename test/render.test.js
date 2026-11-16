'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePdf, darkPixels } = require('./helpers');
const { renderPdf, parsePageRange } = require('../lib/render');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('renders every page to PNG at scale 2 with text and lines drawn', async () => {
  const result = await renderPdf(makePdf(['Potvrdenie KR100 270212', 'Strana 2']), { scale: 2 });
  assert.equal(result.numPages, 2);
  assert.deepEqual(result.pages.map((p) => p.pageNumber), [1, 2]);
  const [page] = result.pages;
  assert.deepEqual([page.width, page.height], [1190, 1684]);
  assert.ok(page.png.subarray(0, 8).equals(PNG_SIGNATURE));
  // heading text (Helvetica glyphs drawn as paths) at y 760 pt -> about 120..170 px from the top
  assert.ok(await darkPixels(page.png, { x: 100, y: 110, w: 900, h: 80 }) > 2000, 'heading text is drawn');
  // table frame: 50 600 495 120 re -> top edge at y = (842 - 720) * 2 = 244 px
  assert.ok(await darkPixels(page.png, { x: 100, y: 240, w: 900, h: 8 }) > 1000, 'table line is drawn');
});

test('renders only the requested pages and skips pages outside the document', async () => {
  const result = await renderPdf(makePdf(['A', 'B', 'C']), { scale: 1, pages: [2, 3, 9] });
  assert.deepEqual(result.pages.map((p) => p.pageNumber), [2, 3]);
  assert.deepEqual([result.pages[0].width, result.pages[0].height], [595, 842]);
});

test('rejects a file that is not a PDF', async () => {
  await assert.rejects(renderPdf(Buffer.from('not a pdf'), {}));
});

test('parsePageRange', () => {
  assert.equal(parsePageRange(''), null);
  assert.equal(parsePageRange('  '), null);
  assert.deepEqual(parsePageRange('1-3,5'), [1, 2, 3, 5]);
  assert.deepEqual(parsePageRange('3, 1, 2-3'), [1, 2, 3]);
  assert.throws(() => parsePageRange('1-x'), /Invalid page range/);
  assert.throws(() => parsePageRange('0'), /Invalid page range/);
  assert.throws(() => parsePageRange('5-2'), /Invalid page range/);
});
