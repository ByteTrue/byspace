import { resolveBySpaceHome } from "../src/server/byspace-home.js";
import { createRootLogger } from "../src/server/logger.js";
import {
  ensureLocalSpeechModels,
  listLocalSpeechModels,
  LocalSttModelIdSchema,
  type LocalSpeechModelId,
} from "../src/server/speech/providers/local/models.js";

function parseArgs(argv: string[]): { modelsDir: string; modelIds: LocalSpeechModelId[] } {
  const home = resolveBySpaceHome();
  let modelsDir = process.env.BYSPACE_LOCAL_MODELS_DIR || `${home}/models/local-speech`;
  const modelIds: LocalSpeechModelId[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--models-dir") {
      modelsDir = argv[++i] ?? modelsDir;
    } else if (arg === "--model") {
      modelIds.push(LocalSttModelIdSchema.parse(argv[++i]));
    }
  }

  if (modelIds.length === 0) modelIds.push(...listLocalSpeechModels().map((model) => model.id));
  return { modelsDir, modelIds };
}

const logger = createRootLogger({ level: "info", format: "pretty" });
const { modelsDir, modelIds } = parseArgs(process.argv.slice(2));
await ensureLocalSpeechModels({ modelsDir, modelIds, logger });
logger.info({ modelsDir, modelIds }, "Done downloading speech models");
