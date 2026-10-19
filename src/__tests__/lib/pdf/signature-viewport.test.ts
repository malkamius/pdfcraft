import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { scanPdfForSignatures } from '@/lib/pdf/processors/signature-extractor';

vi.mock('@/lib/pdf/loader', () => ({
  loadPdfjs: () => import('pdfjs-dist/legacy/build/pdf.mjs'),
}));

describe('PDF.js signature coordinates', () => {
  it.each([
    { rotation: 0, rect: { x: 10, y: 220, width: 40, height: 60 } },
    { rotation: 90, rect: { x: 20, y: 10, width: 60, height: 40 } },
    { rotation: 180, rect: { x: 150, y: 20, width: 40, height: 60 } },
    { rotation: 270, rect: { x: 220, y: 150, width: 60, height: 40 } },
  ])('locates a signature stamp on a page rotated $rotation degrees', async ({ rotation, rect }) => {
    const document = await PDFDocument.create();
    const page = document.addPage([200, 300]);
    page.setRotation(degrees(rotation));
    const stamp = document.context.register(document.context.obj({
      Type: 'Annot',
      Subtype: 'Stamp',
      Rect: [10, 20, 50, 80],
      Name: 'Approved',
    }));
    page.node.set(PDFName.of('Annots'), document.context.obj([stamp]));

    const bytes = await document.save();
    const result = await scanPdfForSignatures(bytes.buffer as ArrayBuffer);

    expect(result.pageCount).toBe(1);
    expect(result.zones).toHaveLength(1);
    expect(result.zones[0]).toMatchObject({
      type: 'stamp',
      pdfRect: [10, 20, 50, 80],
      viewportRect: rect,
    });
  });
});
