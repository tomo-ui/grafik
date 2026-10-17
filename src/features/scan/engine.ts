// Jedno miejsce, z którego ScanProvider ładuje ciężką logikę (Gemini, zod, normalizacja, obraz)
// dynamicznym import() — nie wchodzi do pakietu startowego aplikacji.
export { AiError } from '../../ai/errors';
export { generateSchedule } from '../../ai/gemini';
export {
  batchWithinLimit,
  ImageError,
  ingestImage,
  makeThumbnail,
  MAX_IMAGES,
  renderForUpload,
} from '../../ai/image';
export { buildImportPlan, conflictPolicy, initialDecisions } from '../../ai/importPlan';
export { normalizeSchedule } from '../../ai/normalize';
export { buildPrompt, PROMPT_VERSION } from '../../ai/prompt';
export { nextColor } from '../../domain/people';
