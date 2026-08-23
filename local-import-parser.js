import { searchExercises, normalize } from './exercise-service.js';

export const localImportParser = { parse };

export async function parse(document) {
  const sourceType = { pdf: 'pdf-import', docx: 'docx-import', xlsx: 'xlsx-import' }[document.fileType];
  if (!sourceType || !document.blocks?.length) throw coded('PARSER_FAILURE');
  const preview = { schemaVersion: '1.1', importId: uid(), importedAt: new Date().toISOString(), source: { fileName: document.fileName, fileType: document.fileType, language: document.language || null, documentTitle: null }, program: { id: null, name: baseName(document.fileName), description: null, sourceType, notes: null, days: [] }, warnings: [], unparsedContent: [] };
  let day = null; let section = null;
  for (const block of document.blocks) {
    const rows = block.rows || (block.type === 'paragraph' ? [[block.text]] : []);
    for (const row of rows) {
      const values = row.map(value => String(value || '').trim()).filter(Boolean); if (!values.length) continue;
      const joined = values.join(' ').trim();
      if (isDay(joined)) { day = makeDay(joined, preview.program.days.length + 1, block.sourceReference); preview.program.days.push(day); section = null; continue; }
      if (isSection(joined)) { if (!day) { day = makeDay('Gün 1', 1, block.sourceReference); preview.program.days.push(day); } section = makeSection(joined, day.sections.length + 1, block.sourceReference); day.sections.push(section); continue; }
      const exercise = await parseExercise(values, block.sourceReference, section?.items.length + 1 || 1);
      if (exercise) { if (!day) { day = makeDay('Gün 1', 1, block.sourceReference); preview.program.days.push(day); } if (!section) { section = makeSection('Ana Antrenman', day.sections.length + 1, block.sourceReference); day.sections.push(section); } section.items.push(exercise); }
      else preview.unparsedContent.push({ text: joined, reason: 'Satır güvenli biçimde hareket/bölüm olarak yorumlanamadı.', sourceReference: block.sourceReference, resolutionStatus: 'unresolved' });
    }
  }
  if (!preview.program.days.length) throw coded('PARSER_FAILURE');
  return preview;
}

async function parseExercise(values, sourceReference, order) {
  const parsed = parseRow(values); if (!parsed) return null;
  const candidates = await searchExercises(parsed.name, 5); const exact = candidates.find(item => normalize(item.nameTr) === normalize(parsed.name) || normalize(item.nameEn) === normalize(parsed.name) || item.aliases.some(alias => normalize(alias) === normalize(parsed.name)));
  const probable = !exact && candidates[0]; const match = exact || probable;
  return { itemType: 'exercise', order, sourceExerciseName: parsed.name, normalizedExerciseName: parsed.name, exerciseMatch: match ? { status: exact ? 'matched' : 'probable', exerciseId: match.id, matchedName: match.nameTr, score: exact ? 1 : .65, candidates: candidates.map(item => ({ exerciseId: item.id, name: item.nameTr, score: item.id === match.id ? (exact ? 1 : .65) : .35 })) } : null, resolutionStatus: exact ? 'accepted-canonical' : 'unresolved', userEditedExerciseName: null, prescription: prescription(parsed), notes: parsed.notes || null, sourceReference };
}
function parseRow(values) {
  const first = values[0]; if (!first || /^(exercise|hareket|sets?|set|reps?|tekrar)$/i.test(first)) return null;
  if (values.length === 1) {
    const dash = first.match(/^(.+?)\s*[-—]\s*(.+)$/);
    if (dash && looksPrescription(dash[2])) { const parts = dash[2].split(/\s*[-—]\s*(?=(?:RIR|Rest)\b)/i); const [sets, reps] = splitPrescription(parts[0]); return { name: dash[1], sets, reps, notes: parts.slice(1).join('; ') || null }; }
  }
  const separate = values.length >= 2 && (looksPrescription(values[1]) || looksPrescription(values[2] || ''));
  const inline = first.match(/^(.+?)\s+(\d+(?:\s*(?:x|×)\s*\d+(?:\s*-\s*\d+)?)|\d+\s*(?:warmup|ısınma)\s*\+\s*\d+\s*(?:x|×)\s*\d+(?:\s*-\s*\d+)?)$/i);
  if (separate) return { name: first, sets: values[1] || null, reps: values[2] || null, notes: values.slice(3).join('; ') || null };
  if (inline) { const [sets, reps] = splitPrescription(inline[2]); return { name: inline[1].replace(/\s*[-—]\s*$/, ''), sets, reps }; }
  return null;
}
function prescription(parsed) { const sets = number(parsed.sets); const range = rangeValue(parsed.reps); const rir = parsed.notes?.match(/RIR\s*(\d+)/i); const rest = parsed.notes?.match(/Rest\s*(\d+)\s*(?:sec|sn)/i); return { sets, setsText: parsed.sets && !sets ? parsed.sets : null, repsMin: range?.[0] ?? null, repsMax: range?.[1] ?? null, repsText: parsed.reps || null, weight: null, weightUnit: null, weightText: null, rir: rir ? Number(rir[1]) : null, rirText: null, rpe: null, rpeText: null, restSeconds: rest ? Number(rest[1]) : null, restText: null, tempo: null, tempoText: null, durationSeconds: null, durationText: null, distance: null, distanceUnit: null, distanceText: null, individualSets: [] }; }
function splitPrescription(value) { const warmup = String(value).match(/^(\d+\s*(?:warmup|ısınma)\s*\+\s*\d+)\s*(?:x|×)\s*(.+)$/i); if (warmup) return [warmup[1], warmup[2]]; const match = String(value).match(/^(\d+)\s*(?:x|×)\s*(.+)$/i); return match ? [match[1], match[2]] : [value, null]; }
function number(value) { return /^\d+$/.test(String(value || '').trim()) ? Number(value) : null; }
function rangeValue(value) { const match = String(value || '').match(/^(\d+)(?:\s*-\s*(\d+))?$/); return match ? [Number(match[1]), Number(match[2] || match[1])] : null; }
function looksPrescription(value) { return /\d|amrap|max|failure|warmup|ısınma/i.test(value); }
function isDay(text) { return /\b(upper|lower|push|pull|full body|day|gün)\b/i.test(text) && text.length < 50 && !/\d\s*(?:x|×)/i.test(text); }
function isSection(text) { return /^(main workout|ana antrenman|core|warm.?up|ısınma|activation|aktivasyon|cardio|kardiyo|stretch|mobility|mobilite|cooldown|soğuma)$/i.test(text.trim()); }
function makeDay(name, order, sourceReference) { return { name, order, notes: null, sourceReference, sections: [] }; }
function makeSection(title, order, sourceReference) { return { title, sectionType: sectionType(title), order, notes: null, sourceReference, items: [] }; }
function sectionType(value) { const normalized = normalize(value); return normalized.includes('core') ? 'core' : normalized.includes('warm') || normalized.includes('isinma') ? 'warmup' : normalized.includes('activation') || normalized.includes('aktivasyon') ? 'activation' : normalized.includes('cardio') || normalized.includes('kardiyo') ? 'cardio' : normalized.includes('stretch') ? 'stretch' : normalized.includes('mobil') ? 'mobility' : normalized.includes('cool') || normalized.includes('soguma') ? 'cooldown' : 'strength'; }
function baseName(fileName) { return String(fileName).replace(/\.[^.]+$/, '') || 'İçe Aktarılan Program'; }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function coded(code) { return Object.assign(new Error(code), { code }); }
