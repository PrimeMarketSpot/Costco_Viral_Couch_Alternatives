/* ---------------------------------------------------------------------------
   A minimal, dependency-free PDF writer for monospaced text documents.

   Why hand-rolled: the countersigned agreement is the one artifact a user may
   one day hand to a lawyer. Its generator should be something we can read in a
   sitting and vouch for, not a transitive dependency tree that can be updated
   under us. It only needs to do one thing — lay ASCII text onto paginated pages
   using a base-14 font — and that is about 120 lines.

   Produces PDF 1.4 with Courier (base-14, so no font embedding is required).
   --------------------------------------------------------------------------- */

const PAGE_WIDTH = 612;   // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 54;
const FONT_SIZE = 9;
const LEADING = 12.2;
const MAX_COLS = 84;

const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM) / LEADING);

/** PDF literal strings escape backslash and both parens. */
function escapeText(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Base-14 Courier is WinAnsi; anything outside ASCII would need an encoding map
 * we do not ship. Transliterate the few characters our documents actually use
 * and drop the rest, so a stray smart quote can never corrupt the file.
 */
function toAscii(str) {
  return str
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E\n]/g, '');
}

/** Hard-wrap at MAX_COLS while preserving the source's own line breaks. */
function wrapLines(text) {
  const out = [];
  for (const rawLine of toAscii(text).split('\n')) {
    if (rawLine.length <= MAX_COLS) { out.push(rawLine); continue; }
    let current = '';
    for (const word of rawLine.split(' ')) {
      if (!current.length) {
        current = word;
      } else if (current.length + 1 + word.length <= MAX_COLS) {
        current += ` ${word}`;
      } else {
        out.push(current);
        current = word;
      }
      // A single word longer than the measure: break it rather than overflow.
      while (current.length > MAX_COLS) {
        out.push(current.slice(0, MAX_COLS));
        current = current.slice(MAX_COLS);
      }
    }
    out.push(current);
  }
  return out;
}

function contentStreamFor(lines, pageNumber, pageCount) {
  const startY = PAGE_HEIGHT - MARGIN_TOP;
  const body = lines
    .map((line, i) => {
      const y = (startY - i * LEADING).toFixed(2);
      return `BT /F1 ${FONT_SIZE} Tf ${MARGIN_X} ${y} Td (${escapeText(line)}) Tj ET`;
    })
    .join('\n');

  const footer = `Page ${pageNumber} of ${pageCount}`;
  const footerY = (MARGIN_BOTTOM - 22).toFixed(2);
  const footerCmd =
    `BT /F1 7.5 Tf ${MARGIN_X} ${footerY} Td 0.45 0.45 0.45 rg (${escapeText(footer)}) Tj ET`;

  return `${body}\n${footerCmd}\n`;
}

/**
 * Build a PDF from plain text.
 * @param {string} text
 * @returns {Buffer}
 */
export function textToPdf(text) {
  const allLines = wrapLines(text);

  const pages = [];
  for (let i = 0; i < allLines.length; i += LINES_PER_PAGE) {
    pages.push(allLines.slice(i, i + LINES_PER_PAGE));
  }
  if (!pages.length) pages.push(['']);

  // Object numbering: 1 catalog, 2 pages tree, 3 font, then per page a page
  // object and a content stream.
  const pageObjNum = (i) => 4 + i * 2;
  const contentObjNum = (i) => 5 + i * 2;

  const objects = [];

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';

  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ');
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`;

  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';

  pages.forEach((lines, i) => {
    objects[pageObjNum(i)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum(i)} 0 R >>`;

    const stream = contentStreamFor(lines, i + 1, pages.length);
    objects[contentObjNum(i)] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`;
  });

  // Serialize, recording byte offsets for the xref table.
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  const count = objects.length; // objects 1..n plus the free object 0

  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) {
    pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
