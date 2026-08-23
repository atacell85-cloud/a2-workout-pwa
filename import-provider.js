import { localImportParser } from './local-import-parser.js';
import { openAIImportParser } from './openai-import-parser.js';

export const IMPORT_PARSER_PROVIDER = globalThis.A2_IMPORT_PARSER_PROVIDER || 'local';

export function getImportParser(provider = IMPORT_PARSER_PROVIDER) {
  if (provider === 'openai') return openAIImportParser;
  return localImportParser;
}
