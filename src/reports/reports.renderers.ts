import type { Response } from 'express';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { ReportDataset } from './dto/report.dto';

// File-naming + Content-Disposition are centralised so every report downloads
// with a readable, timestamped name.
export function safeName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function disposition(title: string, ext: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `attachment; filename="${safeName(title)}-${stamp}.${ext}"`;
}

function cellText(v: string | number): string {
  if (typeof v === 'number') return v.toLocaleString('en-NG');
  return v ?? '';
}

export function renderCsv(res: Response, data: ReportDataset) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(esc(data.title));
  lines.push(esc(data.subtitle));
  for (const m of data.meta) lines.push(`${esc(m.label)},${esc(m.value)}`);
  lines.push('');
  lines.push(data.headers.map(esc).join(','));
  for (const row of data.rows) lines.push(row.map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', disposition(data.title, 'csv'));
  res.send(lines.join('\r\n'));
}

export async function renderXlsx(res: Response, data: ReportDataset) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Malique Admin';
  const sheet = wb.addWorksheet(data.title.slice(0, 30) || 'Report');

  sheet.getCell('A1').value = data.title;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').value = data.subtitle;
  sheet.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' } };

  let r = 3;
  for (const m of data.meta) {
    sheet.getCell(`A${r}`).value = m.label;
    sheet.getCell(`A${r}`).font = { bold: true };
    sheet.getCell(`B${r}`).value = m.value;
    r++;
  }
  r++;

  const headerRow = sheet.getRow(r);
  data.headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    c.alignment = { vertical: 'middle' };
  });
  r++;

  for (const row of data.rows) {
    const excelRow = sheet.getRow(r);
    row.forEach((v, i) => {
      const c = excelRow.getCell(i + 1);
      c.value = v;
      if (data.numericCols.includes(i)) c.alignment = { horizontal: 'right' };
    });
    r++;
  }

  // Reasonable column widths based on the longest value per column.
  data.headers.forEach((h, i) => {
    let max = h.length;
    for (const row of data.rows) max = Math.max(max, String(row[i] ?? '').length);
    sheet.getColumn(i + 1).width = Math.min(40, Math.max(12, max + 2));
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', disposition(data.title, 'xlsx'));
  await wb.xlsx.write(res);
  res.end();
}

export async function renderDocx(res: Response, data: ReportDataset) {
  const headCell = (h: string) =>
    new TableCell({
      width: { size: 100 / data.headers.length, type: WidthType.PERCENTAGE },
      shading: { fill: '1E3A5F' },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF' })] })],
    });
  const bodyCell = (v: string | number, numeric: boolean) =>
    new TableCell({
      children: [
        new Paragraph({
          alignment: numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun(cellText(v))],
        }),
      ],
    });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: data.headers.map(headCell) }),
      ...data.rows.map(
        (row) =>
          new TableRow({
            children: row.map((v, i) => bodyCell(v, data.numericCols.includes(i))),
          }),
      ),
    ],
  });

  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: data.title, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: data.subtitle, italics: true })] }),
    new Paragraph({ text: '' }),
  ];
  for (const m of data.meta) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${m.label}: `, bold: true }), new TextRun(m.value)],
      }),
    );
  }
  children.push(new Paragraph({ text: '' }));
  children.push(table);

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', disposition(data.title, 'docx'));
  res.end(buffer);
}

export function renderPdf(res: Response, data: ReportDataset) {
  const doc = new PDFDocument({ size: 'A4', layout: data.headers.length > 6 ? 'landscape' : 'portrait', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', disposition(data.title, 'pdf'));
  doc.pipe(res);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  doc.fontSize(16).fillColor('#0f2942').text(data.title);
  doc.fontSize(9).fillColor('#64748b').text(data.subtitle);
  doc.moveDown(0.5);

  doc.fontSize(9).fillColor('#334155');
  for (const m of data.meta) {
    doc.text(`${m.label}: ${m.value}`);
  }
  doc.moveDown(0.8);

  const cols = data.headers.length;
  const widths = data.headers.map((_, i) =>
    data.numericCols.includes(i) ? pageWidth * 0.13 : (pageWidth - pageWidth * 0.13 * data.numericCols.length) / (cols - data.numericCols.length),
  );

  let y = doc.y;
  const rowH = 18;

  const drawHeader = () => {
    doc.rect(left, y, pageWidth, rowH).fill('#1e3a5f');
    doc.fillColor('#ffffff').fontSize(8);
    let x = left + 4;
    data.headers.forEach((h, i) => {
      doc.text(h, x, y + 5, { width: widths[i] - 6, ellipsis: true });
      x += widths[i];
    });
    y += rowH;
    doc.fillColor('#334155').fontSize(8);
  };

  drawHeader();

  data.rows.forEach((row, ri) => {
    if (y + rowH > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    if (ri % 2 === 0) doc.rect(left, y, pageWidth, rowH).fill('#f8fafc');
    doc.fillColor('#334155').fontSize(8);
    let x = left + 4;
    row.forEach((v, i) => {
      const numeric = data.numericCols.includes(i);
      const text = cellText(v);
      if (numeric) {
        doc.text(text, x, y + 5, { width: widths[i] - 8, align: 'right' });
      } else {
        doc.text(text, x, y + 5, { width: widths[i] - 6, ellipsis: true });
      }
      x += widths[i];
    });
    y += rowH;
  });

  doc
    .fontSize(7)
    .fillColor('#94a3b8')
    .text(
      `Generated ${new Date().toLocaleString('en-NG')} · Designed & developed by Black-Box Tech`,
      left,
      doc.page.height - doc.page.margins.bottom + 10,
      { width: pageWidth, align: 'center' },
    );

  doc.end();
}

// ─── Branded single-document layout (invoice / delivery manifest) ─────
export interface RenderDocumentLine {
  description: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export interface RenderDocument {
  docType: string; // "TAX INVOICE / RECEIPT" | "DELIVERY MANIFEST"
  title: string; // used for the download filename
  number: string; // order / delivery reference
  date: string;
  partyLabel: string; // "Billed To" | "Deliver To"
  party: { name: string; phone?: string | null; email?: string | null; address?: string | null };
  meta: { label: string; value: string }[];
  lines: RenderDocumentLine[];
  totals: { label: string; value: string; strong?: boolean }[];
  notes?: string | null;
}

export function renderDocumentPdf(res: Response, d: RenderDocument) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', disposition(d.title, 'pdf'));
  doc.pipe(res);

  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  // Brand band
  doc.rect(0, 0, doc.page.width, 96).fill('#0f2942');
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('Malique Oil and Gas Ltd', left, 28);
  doc.fontSize(9).font('Helvetica').fillColor('#cbd5e1')
    .text('Clean energy · LPG cylinders, refills & accessories', left, 58);
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#f59e0b')
    .text(d.docType, left, 30, { width: pageW, align: 'right' });

  // Reference block
  doc.y = 116;
  doc.fillColor('#0f2942').fontSize(11).font('Helvetica-Bold')
    .text(`Ref: ${d.number}`, left, doc.y);
  doc.fillColor('#475569').fontSize(9).font('Helvetica').text(`Date: ${d.date}`, left, doc.y + 16);

  // Party card (right side)
  const partyW = pageW * 0.45;
  const partyX = right - partyW;
  const partyLines = [d.party.phone, d.party.address, d.party.email].filter(Boolean).length;
  let py = doc.y - 4;
  doc.rect(partyX, py, partyW, 28 + 13 * partyLines).fill('#f1f5f9');
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text(d.partyLabel.toUpperCase(), partyX + 8, py + 6, { characterSpacing: 1 });
  py += 20;
  doc.fillColor('#0f2942').fontSize(10).font('Helvetica-Bold').text(d.party.name || '—', partyX + 8, py, { width: partyW - 16 });
  doc.font('Helvetica').fontSize(9).fillColor('#475569');
  for (const line of [d.party.phone, d.party.address, d.party.email]) {
    if (line) { py += 13; doc.text(String(line), partyX + 8, py, { width: partyW - 16 }); }
  }

  // Meta strip (branch / status / payment / rider…)
  let mx = left;
  let my = doc.y + 34;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b');
  for (const m of d.meta) {
    if (mx + 140 > right) { mx = left; my += 28; }
    doc.text(m.label.toUpperCase(), mx, my);
    doc.fillColor('#0f2942').font('Helvetica').fontSize(9).text(m.value, mx, my + 11, { width: 140, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b');
    mx += 150;
  }

  // Line items table
  const tableY = my + 34;
  const cols = [pageW * 0.52, pageW * 0.14, pageW * 0.17, pageW * 0.17];
  let y = tableY;
  const rowH = 22;
  doc.rect(left, y, pageW, rowH).fill('#1e3a5f');
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
  const heads = ['Item', 'Qty', 'Unit Price (₦)', 'Total (₦)'];
  let x = left + 6;
  heads.forEach((h, i) => {
    doc.text(h, x, y + 7, { width: cols[i] - 10, align: i >= 1 ? 'right' : 'left' });
    x += cols[i];
  });
  y += rowH;

  doc.fontSize(9).font('Helvetica');
  if (!d.lines.length) {
    doc.fillColor('#94a3b8').text('No line items', left + 6, y + 6);
    y += rowH;
  }
  d.lines.forEach((ln, ri) => {
    if (y + rowH > doc.page.height - 120) { doc.addPage(); y = doc.page.margins.top; }
    if (ri % 2 === 0) doc.rect(left, y, pageW, rowH).fill('#f8fafc');
    doc.fillColor('#0f2942');
    x = left + 6;
    doc.text(ln.description, x, y + 6, { width: cols[0] - 10, ellipsis: true }); x += cols[0];
    doc.text(String(ln.qty), x, y + 6, { width: cols[1] - 10, align: 'right' }); x += cols[1];
    doc.text(ln.unitPrice.toLocaleString('en-NG'), x, y + 6, { width: cols[2] - 10, align: 'right' }); x += cols[2];
    doc.text(ln.total.toLocaleString('en-NG'), x, y + 6, { width: cols[3] - 10, align: 'right' });
    y += rowH;
  });

  // Totals block
  y += 8;
  const totalsW = pageW * 0.45;
  const totalsX = right - totalsW;
  const totalsH = 12 + d.totals.length * 18;
  if (y + totalsH > doc.page.height - 120) { doc.addPage(); y = doc.page.margins.top; }
  doc.rect(totalsX, y, totalsW, totalsH).fill('#e2e8f0');
  let ty = y + 6;
  for (const t of d.totals) {
    doc.font(t.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(t.strong ? 11 : 9)
      .fillColor(t.strong ? '#0f2942' : '#475569')
      .text(t.label, totalsX + 8, ty, { width: totalsW * 0.5 });
    doc.text(t.value, totalsX + totalsW * 0.5, ty, { width: totalsW * 0.5 - 8, align: 'right' });
    ty += 18;
  }
  y = ty + 14;

  if (d.notes) {
    doc.font('Helvetica').fontSize(8).fillColor('#64748b')
      .text(`Note: ${d.notes}`, left, Math.min(y, doc.page.height - 110), { width: pageW });
  }

  // Footer on every page
  const endFooter = () => {
    doc.fontSize(7).fillColor('#94a3b8').font('Helvetica')
      .text(
        `Generated ${new Date().toLocaleString('en-NG')} · Designed & developed by Black-Box Tech`,
        left, doc.page.height - 40, { width: pageW, align: 'center' },
      );
  };
  endFooter();
  doc.on('pageAdded', endFooter);

  doc.end();
}
