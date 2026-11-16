'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makePdf } = require('./helpers');
const { PdfRender } = require('../nodes/PdfRender/PdfRender.node');
const { locatePdfjs } = require('../lib/pdfjs');

// Minimal stand-in for the n8n execute context.
function context(items, params = {}, { continueOnFail = false } = {}) {
  const defaults = { binaryPropertyName: 'data', scale: 1, outputPropertyName: 'data', pageRange: '' };
  return {
    getInputData: () => items,
    getNodeParameter: (name, i, fallback) => (name in params ? params[name] : (name in defaults ? defaults[name] : fallback)),
    getNode: () => ({ name: 'Render PDF pages' }),
    continueOnFail: () => continueOnFail,
    helpers: {
      assertBinaryData(i, prop) {
        const b = items[i].binary && items[i].binary[prop];
        if (!b) throw new Error(`This operation expects the node's input data to contain a binary file '${prop}', but none was found [item ${i}]`);
        return b;
      },
      getBinaryDataBuffer: async (i, prop) => Buffer.from(items[i].binary[prop].data, 'base64'),
      prepareBinaryData: async (buf, fileName, mimeType) => ({ data: buf.toString('base64'), fileName, mimeType }),
    },
  };
}

const pdfItem = (texts, fileName) => ({
  json: { fileName, index: 0 },
  binary: { data: { data: makePdf(texts).toString('base64'), fileName, mimeType: 'application/pdf' } },
});

test('description: node name, file icon and parameters', () => {
  const d = new PdfRender().description;
  assert.equal(d.name, 'pdfRender');
  assert.equal(d.icon, 'file:pdfRender.svg');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'nodes', 'PdfRender', 'pdfRender.svg')));
  assert.deepEqual(d.properties.map((p) => p.name), ['binaryPropertyName', 'scale', 'outputPropertyName', 'pageRange']);
});

test('one item per page, in order, with the Bitovi-compatible json and binary', async () => {
  const items = [pdfItem(['A', 'B'], 'Objednavka_1.pdf'), pdfItem(['C'], 'second.PDF')];
  const [out] = await new PdfRender().execute.call(context(items));
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((o) => [o.json.sourceFile, o.json.pageNumber, o.json.totalPages, o.pairedItem.item]), [
    ['Objednavka_1.pdf', 1, 2, 0],
    ['Objednavka_1.pdf', 2, 2, 0],
    ['second.PDF', 1, 1, 1],
  ]);
  assert.deepEqual([out[0].json.width, out[0].json.height], [595, 842]);
  assert.equal(out[1].binary.data.fileName, 'Objednavka_1_2.png');
  assert.equal(out[2].binary.data.fileName, 'second_1.png');
  assert.equal(out[0].binary.data.mimeType, 'image/png');
});

test('page range and output property', async () => {
  const [out] = await new PdfRender().execute.call(context([pdfItem(['A', 'B', 'C'], 'x.pdf')], { pageRange: '2-3', outputPropertyName: 'image' }));
  assert.deepEqual(out.map((o) => o.json.pageNumber), [2, 3]);
  assert.ok(out[0].binary.image);
});

test('continueOnFail: error item keeps the input json and pairs with its item', async () => {
  const items = [{ json: { fileName: 'missing.pdf' } }, pdfItem(['A'], 'ok.pdf')];
  const [out] = await new PdfRender().execute.call(context(items, {}, { continueOnFail: true }));
  assert.equal(out.length, 2);
  assert.equal(out[0].json.fileName, 'missing.pdf');
  assert.match(out[0].json.error, /binary file 'data'/);
  assert.equal(out[0].pairedItem.item, 0);
  assert.equal(out[1].json.pageNumber, 1);
});

test('without continueOnFail the error is thrown', async () => {
  await assert.rejects(new PdfRender().execute.call(context([{ json: {} }])), /binary file 'data'/);
});

test('locatePdfjs finds pdfjs-dist next to n8n-nodes-base of an n8n install', () => {
  const saved = process.env.PDF_RENDER_PDFJS_DIR;
  delete process.env.PDF_RENDER_PDFJS_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-'));
  try {
    for (const pkg of ['n8n-nodes-base', 'pdfjs-dist']) {
      fs.mkdirSync(path.join(root, 'node_modules', pkg), { recursive: true });
      fs.writeFileSync(path.join(root, 'node_modules', pkg, 'package.json'), JSON.stringify({ name: pkg }));
    }
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"n8n"}');
    const found = locatePdfjs([path.join(root, 'nonexistent', 'bin', 'n8n'), path.join(root, 'package.json')]);
    assert.equal(found.pdfjsDir, fs.realpathSync(path.join(root, 'node_modules', 'pdfjs-dist')));
    assert.throws(() => locatePdfjs([path.join(os.tmpdir(), 'no-n8n-here', 'x.js')]), /not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    process.env.PDF_RENDER_PDFJS_DIR = saved;
  }
});
