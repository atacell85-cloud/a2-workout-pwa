const ACCEPTED = { pdf: ['application/pdf'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] };

export const documentExtractor = { extract };

export async function extract(file) {
  const fileType = detectFileType(file);
  if (!fileType) throw coded('UNSUPPORTED_FILE');
  if (!file.size) throw coded('EMPTY_DOCUMENT');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const blocks = fileType === 'pdf' ? await extractPdf(bytes) : fileType === 'docx' ? await extractDocx(bytes) : await extractXlsx(bytes);
    if (!blocks.length) throw coded(fileType === 'pdf' ? 'SCAN_ONLY_PDF' : 'EMPTY_DOCUMENT');
    return { fileName: file.name, fileType, extractedAt: new Date().toISOString(), language: null, blocks };
  } catch (error) {
    if (error.code === 'CORRUPT_ZIP' && fileType === 'docx') throw coded('CORRUPT_DOCX');
    if (error.code === 'CORRUPT_ZIP' && fileType === 'xlsx') throw coded('CORRUPT_XLSX');
    if (error.code) throw error;
    throw coded(`CORRUPT_${fileType.toUpperCase()}`);
  }
}

export function detectFileType(file) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  if (!['pdf', 'docx', 'xlsx'].includes(extension)) return null;
  return !file.type || ACCEPTED[extension].includes(file.type) ? extension : null;
}

async function extractPdf(bytes) {
  const text = binaryText(bytes);
  if (!text.startsWith('%PDF')) throw coded('CORRUPT_PDF');
  const blocks = []; let page = 0;
  for (const stream of text.matchAll(/(<<[\s\S]{0,512}?>>)?\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    page += 1;
    const source = stream[2];
    const decoded = /\/FlateDecode/.test(stream[1] || '') ? await inflate(new Uint8Array([...source].map(char => char.charCodeAt(0))), 'deflate') : new TextEncoder().encode(source);
    const streamText = new TextDecoder('latin1').decode(decoded);
    const values = [...streamText.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj|\[([^\]]*)\]\s*TJ/g)].map(match => decodePdf(match[0])).filter(Boolean);
    values.forEach(value => blocks.push({ type: 'paragraph', text: value, sourceReference: ref({ page, text: value }) }));
  }
  return blocks;
}
function decodePdf(value) { return value.replace(/\[|\]|\([^)]*\)\s*Tj/g, token => token.startsWith('(') ? token.slice(1, -4).replace(/\\([()\\])/g, '$1') : '').replace(/\([^)]*\)/g, token => token.slice(1, -1)).replace(/\s+/g, ' '); }

async function extractDocx(bytes) {
  const zip = await readZip(bytes); const xml = await zip.text('word/document.xml'); if (!xml) throw coded('CORRUPT_DOCX');
  const document = new DOMParser().parseFromString(xml, 'application/xml'); if (document.querySelector('parsererror')) throw coded('CORRUPT_DOCX');
  const blocks = []; let index = 0;
  const body = nodes(document, 'body')[0];
  [...(body?.children || [])].filter(node => ['p', 'tbl'].includes(node.localName)).forEach(node => {
    index += 1;
    if (node.localName === 'p') { const text = node.textContent.trim(); if (text) blocks.push({ type: 'paragraph', text, sourceReference: ref({ text }) }); }
    else { const rows = nodes(node, 'tr').map(row => nodes(row, 'tc').map(cell => cell.textContent.trim())); if (rows.length) blocks.push({ type: 'table', rows, sourceReference: ref({ text: rows.flat().join(' | ') }) }); }
  });
  return blocks;
}

async function extractXlsx(bytes) {
  const zip = await readZip(bytes); const workbookXml = await zip.text('xl/workbook.xml'); const relsXml = await zip.text('xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relsXml) throw coded('CORRUPT_XLSX');
  const shared = await sharedStrings(zip); const workbook = xml(workbookXml); const rels = xml(relsXml); const blocks = [];
  for (const sheet of nodes(workbook, 'sheet')) {
    const relation = nodes(rels, 'Relationship').find(item => item.getAttribute('Id') === sheet.getAttribute('r:id')); const target = relation?.getAttribute('Target'); if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\/+/, '')}`; const sheetXml = await zip.text(path); if (!sheetXml) continue;
    const rows = nodes(xml(sheetXml), 'row').map(row => nodes(row, 'c').map(cell => cellValue(cell, shared))).filter(row => row.some(Boolean));
    if (rows.length) blocks.push({ type: 'sheet', name: sheet.getAttribute('name'), rows, usedRange: `A1:${columnName(Math.max(...rows.map(row => row.length)))}${rows.length}`, sourceReference: ref({ sheet: sheet.getAttribute('name'), text: rows.flat().join(' | ') }) });
  }
  return blocks;
}

async function sharedStrings(zip) { const value = await zip.text('xl/sharedStrings.xml'); return value ? nodes(xml(value), 'si').map(item => item.textContent || '') : []; }
function cellValue(cell, shared) { const value = nodes(cell, 'v')[0]?.textContent || ''; return cell.getAttribute('t') === 's' ? (shared[Number(value)] || '') : cell.getAttribute('t') === 'inlineStr' ? cell.textContent : value || nodes(cell, 'f')[0]?.textContent || ''; }
function xml(value) { const doc = new DOMParser().parseFromString(value, 'application/xml'); if (nodes(doc, 'parsererror').length) throw coded('CORRUPT_XLSX'); return doc; }
function nodes(root, name) { return [...root.getElementsByTagNameNS('*', name)]; }
function columnName(number) { let text = ''; while (number) { number -= 1; text = String.fromCharCode(65 + number % 26) + text; number = Math.floor(number / 26); } return text || 'A'; }

async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i -= 1) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw coded('CORRUPT_ZIP'); const count = view.getUint16(eocd + 10, true); let offset = view.getUint32(eocd + 16, true); const entries = new Map();
  for (let i = 0; i < count; i += 1) { if (view.getUint32(offset, true) !== 0x02014b50) throw coded('CORRUPT_ZIP'); const method = view.getUint16(offset + 10, true); const compressed = view.getUint32(offset + 20, true); const nameLength = view.getUint16(offset + 28, true); const extraLength = view.getUint16(offset + 30, true); const commentLength = view.getUint16(offset + 32, true); const local = view.getUint32(offset + 42, true); const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength)); entries.set(name, { method, compressed, local }); offset += 46 + nameLength + extraLength + commentLength; }
  return { async text(name) { const entry = entries.get(name); if (!entry || view.getUint32(entry.local, true) !== 0x04034b50) return null; const nameLength = view.getUint16(entry.local + 26, true); const extraLength = view.getUint16(entry.local + 28, true); const input = bytes.slice(entry.local + 30 + nameLength + extraLength, entry.local + 30 + nameLength + extraLength + entry.compressed); const output = entry.method === 0 ? input : entry.method === 8 ? await inflate(input) : null; return output ? new TextDecoder().decode(output) : null; } };
}
async function inflate(input, format = 'deflate-raw') { if (!globalThis.DecompressionStream) throw coded('UNSUPPORTED_BROWSER_COMPRESSION'); const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream(format)); return new Uint8Array(await new Response(stream).arrayBuffer()); }
function ref({ page = null, sheet = null, cellRange = null, text = null } = {}) { return { page, sheet, cellRange, text }; }
function coded(code) { return Object.assign(new Error(code), { code }); }
function binaryText(bytes) { let value = ''; for (let index = 0; index < bytes.length; index += 8192) value += String.fromCharCode(...bytes.subarray(index, index + 8192)); return value; }
