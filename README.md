# n8n-nodes-pdf-render

[![CI](https://github.com/LubosVoska/n8n-nodes-pdf-render/actions/workflows/ci.yml/badge.svg)](https://github.com/LubosVoska/n8n-nodes-pdf-render/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/n8n-nodes-pdf-render)](https://www.npmjs.com/package/n8n-nodes-pdf-render)

An [n8n](https://n8n.io) community node that renders PDF pages to PNG images, one output item per page.

**PDF Render** is a drop-in replacement for `@bitovi/n8n-nodes-pdf-to-png`, which fails on n8n 2.47+ with
`Value is none of these types \`String\`, \`Path\``: n8n now ships its own `pdfjs-dist` (6.x) and
`@napi-rs/canvas` (1.x), pdf.js sets the global `Path2D` / `DOMMatrix` from the first canvas library it
loads, and a node with its own canvas copy then draws pdf.js paths from another native copy, which the
canvas rejects.

This node has **no runtime dependencies**. It loads pdf.js and `@napi-rs/canvas` from the running n8n
(`n8n-nodes-base` → `pdfjs-dist` → `@napi-rs/canvas`), so the process keeps one canvas library and the node
follows n8n's versions on every update. While it renders it also swaps in the pdf.js globals of that
canvas (and restores the previous ones), so a PDF node loaded earlier with another canvas copy cannot
break it.

## Parameters

| Parameter | Default | |
|---|---|---|
| Binary Property | `data` | input binary property with the PDF |
| Scale | `2` | 1 = 72 DPI, 2 = 144 DPI (A4 → 1190 × 1684 px) |
| Output Property | `data` | output binary property for the PNG |
| Page Range | empty | `1-3` or `1,3,5`; empty = all pages |

Output per page (same as the Bitovi node): `json { pageNumber, width, height, totalPages, sourceFile }`,
`binary[outputProperty]` = PNG (`<pdf name>_<page>.png`), `pairedItem` = the input item. With "On Error:
Continue" a failed PDF yields `{ ...input json, error }`.

pdf.js options: `disableFontFace: true` (glyphs drawn as paths), standard fonts, CMaps, ICC profiles and
wasm decoders from the pdfjs-dist directory n8n uses, `isEvalSupported: false`.

## Installation

In n8n go to **Settings → Community Nodes → Install**, enter `n8n-nodes-pdf-render` and confirm. See the
[n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

The node appears as **PDF Render**; its type in workflows is `n8n-nodes-pdf-render.pdfRender`.

Tested with n8n 2.47.7 (`pdfjs-dist` 6.3.289, `@napi-rs/canvas` 1.0.11).

If n8n is installed somewhere other than `/usr/local/lib/node_modules/n8n` and the lookup fails, set the
environment variable `PDF_RENDER_PDFJS_DIR` to the `pdfjs-dist` directory n8n uses.

## Development

```sh
npm install
npm test
```

The devDependencies pin the versions n8n 2.47.7 ships (`pdfjs-dist` 6.3.289, `@napi-rs/canvas` 1.0.11)
plus `@napi-rs/canvas` 0.1.100 (as `canvas-old`, the Bitovi copy) to reproduce the conflict.
pdfjs-dist 6 needs Node ≥ 22.13; `test/helpers.js` polyfills the two missing APIs so the tests also run
on Node 20 (test-only).

## Releasing

1. Bump the version: `npm version patch` (or `minor` / `major`). This commits and creates the tag `vX.Y.Z`.
2. Push: `git push --follow-tags`.
3. Create a GitHub release from the tag. The **Publish to npm** workflow runs the tests and publishes the
   package with npm provenance.

## License

[MIT](LICENSE)
