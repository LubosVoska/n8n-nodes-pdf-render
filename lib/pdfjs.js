'use strict';
// Loads pdf.js and @napi-rs/canvas from the n8n installation, never from this package.
//
// Why: n8n (2.47+) ships pdfjs-dist + @napi-rs/canvas itself (n8n-nodes-base, used by Extract From File).
// pdf.js fills the global Path2D / DOMMatrix / ImageData from the canvas library it loads first, for the
// whole process. A node that brings its own @napi-rs/canvas then draws with objects from another native
// copy, and the canvas rejects them: "Value is none of these types `String`, `Path`". Using exactly the
// copies n8n loads keeps one canvas library in the process. The package therefore has no runtime
// dependencies (pdfjs-dist and @napi-rs/canvas are devDependencies for the tests only).
//
// Lookup order:
//   1. env PDF_RENDER_PDFJS_DIR: the pdfjs-dist package directory to use (tests, unusual installs);
//   2. n8n-nodes-base resolved from the running n8n (process.argv[1], require.main, the default global
//      install dir of the Docker image), then pdfjs-dist resolved from n8n-nodes-base.
// @napi-rs/canvas is always resolved from the pdfjs-dist directory, so it is the copy pdf.js itself loads.
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const N8N_INSTALL_DIRS = ['/usr/local/lib/node_modules/n8n'];

function candidateBases() {
  const bases = [];
  if (process.argv[1]) {
    try { bases.push(fs.realpathSync(process.argv[1])); } catch (e) { /* not a file */ }
  }
  if (require.main && require.main.filename) bases.push(require.main.filename);
  for (const dir of N8N_INSTALL_DIRS) bases.push(path.join(dir, 'package.json'));
  return bases;
}

// Package directory (real path) of `name` as Node would find it from `fromFile`. Walks the node_modules
// lookup paths instead of resolving `${name}/package.json`, because an "exports" map may hide package.json.
// The real path matters for pnpm layouts: a package's own dependencies sit next to its real directory.
function resolvePackageDir(fromFile, name) {
  let paths;
  try { paths = createRequire(fromFile).resolve.paths(name) || []; } catch (e) { return null; }
  for (const dir of paths) {
    const pkgJson = path.join(dir, name, 'package.json');
    if (fs.existsSync(pkgJson)) return fs.realpathSync(path.dirname(pkgJson));
  }
  return null;
}

function locatePdfjs(bases = candidateBases()) {
  const fromEnv = process.env.PDF_RENDER_PDFJS_DIR;
  if (fromEnv) {
    if (!fs.existsSync(path.join(fromEnv, 'package.json'))) {
      throw new Error(`PDF_RENDER_PDFJS_DIR "${fromEnv}" does not contain a pdfjs-dist package`);
    }
    return { pdfjsDir: fs.realpathSync(fromEnv), source: 'PDF_RENDER_PDFJS_DIR' };
  }
  for (const base of bases) {
    const nodesBase = resolvePackageDir(base, 'n8n-nodes-base');
    if (!nodesBase) continue;
    const pdfjsDir = resolvePackageDir(path.join(nodesBase, 'package.json'), 'pdfjs-dist');
    if (pdfjsDir) return { pdfjsDir, source: nodesBase };
  }
  throw new Error(
    'pdf.js of the n8n installation was not found (n8n-nodes-base -> pdfjs-dist). ' +
    'Set PDF_RENDER_PDFJS_DIR to the pdfjs-dist directory n8n uses.',
  );
}

// pdf.js asset "URL" for Node: a directory path that must end with "/" (pdf.js checks the slash and then
// reads base + file name with fs.readFile; forward slashes also work on Windows).
function assetDir(...parts) {
  const dir = path.join(...parts);
  return fs.existsSync(dir) ? dir.split(path.sep).join('/') + '/' : undefined;
}

let loading = null;

// Cached for the process: { pdfjs, canvas, worker, pdfjsDir, version, source, assets }.
function loadLibs() {
  if (!loading) {
    loading = (async () => {
      const { pdfjsDir, source } = locatePdfjs();
      const canvas = createRequire(path.join(pdfjsDir, 'package.json'))('@napi-rs/canvas');
      const build = path.join(pdfjsDir, 'legacy', 'build');
      const pdfjs = await import(pathToFileURL(path.join(build, 'pdf.mjs')).href);
      const workerFile = path.join(build, 'pdf.worker.mjs');
      const worker = fs.existsSync(workerFile) ? await import(pathToFileURL(workerFile).href) : null;
      return {
        pdfjs,
        canvas,
        worker,
        pdfjsDir,
        source,
        version: pdfjs.version,
        // Missing directories stay undefined, so an older pdf.js without e.g. iccs/ still works.
        assets: {
          cMapUrl: assetDir(pdfjsDir, 'cmaps'),
          standardFontDataUrl: assetDir(pdfjsDir, 'standard_fonts'),
          wasmUrl: assetDir(pdfjsDir, 'wasm'),
          iccUrl: assetDir(pdfjsDir, 'iccs'),
        },
      };
    })().catch((err) => {
      loading = null; // allow a later retry, e.g. after fixing PDF_RENDER_PDFJS_DIR
      throw err;
    });
  }
  return loading;
}

module.exports = { loadLibs, locatePdfjs, resolvePackageDir, candidateBases };
