import fs from "node:fs";
import { dump, load } from "js-yaml";

export function mergeUpdaterManifest(firstPath, secondPath, outputPath) {
  const first = load(fs.readFileSync(firstPath, "utf8"));
  const second = load(fs.readFileSync(secondPath, "utf8"));
  const files = [...(first.files ?? []), ...(second.files ?? [])].filter(
    (file, index, all) => all.findIndex((entry) => entry.url === file.url) === index,
  );
  const output = dump({ ...first, files }, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(outputPath, output);
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , firstPath, secondPath, outputPath] = process.argv;
  if (!firstPath || !secondPath || !outputPath) {
    throw new Error(
      "Usage: node scripts/merge-updater-manifest.mjs <first.yml> <second.yml> <out.yml>",
    );
  }
  process.stdout.write(mergeUpdaterManifest(firstPath, secondPath, outputPath));
}
