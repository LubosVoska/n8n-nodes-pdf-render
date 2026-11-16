'use strict';
// n8n node "PDF Render": one output item per rendered page, binary PNG.
// Output matches @bitovi/n8n-nodes-pdf-to-png (json pageNumber / width / height / totalPages / sourceFile,
// binary under outputPropertyName, pairedItem to the input item), so it can replace that node as is.
const { renderPdf, parsePageRange } = require('../../lib/render');

function operationError(node, error, itemIndex) {
  try {
    const { NodeOperationError } = require('n8n-workflow');
    return new NodeOperationError(node, error, { itemIndex });
  } catch (e) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

class PdfRender {
  constructor() {
    this.description = {
      displayName: 'PDF Render',
      name: 'pdfRender',
      icon: 'file:pdfRender.svg',
      group: ['transform'],
      version: 1,
      subtitle: '={{ "scale " + $parameter["scale"] }}',
      description: 'Renders PDF pages to PNG images with the pdf.js bundled in n8n',
      defaults: { name: 'PDF Render' },
      inputs: ['main'],
      outputs: ['main'],
      properties: [
        {
          displayName: 'Binary Property',
          name: 'binaryPropertyName',
          type: 'string',
          default: 'data',
          required: true,
          description: 'Name of the input binary property that holds the PDF',
        },
        {
          displayName: 'Scale',
          name: 'scale',
          type: 'number',
          default: 2,
          typeOptions: { minValue: 0.5, maxValue: 5, numberPrecision: 2 },
          description: '1 = 72 DPI, 2 = 144 DPI (an A4 page becomes 1191 x 1684 px)',
        },
        {
          displayName: 'Output Property',
          name: 'outputPropertyName',
          type: 'string',
          default: 'data',
          description: 'Name of the output binary property for the PNG',
        },
        {
          displayName: 'Page Range',
          name: 'pageRange',
          type: 'string',
          default: '',
          placeholder: '1-3 or 1,3,5',
          description: 'Pages to render; empty = all pages',
        },
      ],
    };
  }

  async execute() {
    const items = this.getInputData();
    const results = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, 'data');
        const scale = this.getNodeParameter('scale', i, 2);
        const outputPropertyName = this.getNodeParameter('outputPropertyName', i, 'data');
        const pages = parsePageRange(this.getNodeParameter('pageRange', i, ''));

        const meta = this.helpers.assertBinaryData(i, binaryPropertyName);
        const pdf = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
        const rendered = await renderPdf(pdf, { scale, pages });

        const sourceFile = meta.fileName || '';
        const baseName = sourceFile.replace(/\.pdf$/i, '') || 'page';
        for (const page of rendered.pages) {
          const binary = await this.helpers.prepareBinaryData(page.png, `${baseName}_${page.pageNumber}.png`, 'image/png');
          results.push({
            json: {
              pageNumber: page.pageNumber,
              width: page.width,
              height: page.height,
              totalPages: rendered.pages.length,
              sourceFile,
            },
            binary: { [outputPropertyName]: binary },
            pairedItem: { item: i },
          });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          results.push({
            json: { ...items[i].json, error: error && error.message ? error.message : String(error) },
            pairedItem: { item: i },
          });
          continue;
        }
        throw operationError(this.getNode(), error, i);
      }
    }
    return [results];
  }
}

module.exports = { PdfRender };
