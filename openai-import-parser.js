export const openAIImportParser = { parse };

export async function parse(normalizedDocument, { importId, signal } = {}) {
  if (!navigator.onLine) throw coded('OPENAI_OFFLINE');
  const endpoint = globalThis.A2_IMPORT_PROXY_URL || '/api/import/parse';
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ normalizedDocument, importId, options: {} }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw coded(body.code || 'OPENAI_REQUEST_FAILED');
  if (!body.preview || body.preview.schemaVersion !== '1.1') throw coded('OPENAI_INVALID_RESPONSE');
  return body.preview;
}
function coded(code) { return Object.assign(new Error(code), { code }); }
