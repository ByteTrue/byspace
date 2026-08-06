import { listLocalSpeechModels } from "../src/server/speech/providers/local/models.js";

for (const model of listLocalSpeechModels()) {
  // eslint-disable-next-line no-console
  console.log(`${model.id}\t${model.label}\t${model.description}`);
}
