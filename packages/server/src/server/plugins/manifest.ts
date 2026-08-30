import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PluginIdSchema } from "@getpaseo/protocol/messages";

export const BYSPACE_PLUGIN_MANIFEST_FILENAME = "byspace-plugin.json";
export const LEGACY_PASEO_PLUGIN_MANIFEST_FILENAME = "paseo-plugin.json";
const PluginManifestSchema = z.object({ id: PluginIdSchema }).strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

async function isFile(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then((info) => info.isFile())
    .catch(() => false);
}

async function resolvePluginManifestPath(directory: string): Promise<string> {
  const byspacePath = path.join(directory, BYSPACE_PLUGIN_MANIFEST_FILENAME);
  const legacyPath = path.join(directory, LEGACY_PASEO_PLUGIN_MANIFEST_FILENAME);
  const [hasByspaceManifest, hasLegacyManifest] = await Promise.all([
    isFile(byspacePath),
    // COMPAT(byspacePluginManifestFilename): added after v0.7.0-beta.2; remove when legacy paseo-plugin.json plugins are no longer supported.
    isFile(legacyPath),
  ]);
  if (hasByspaceManifest && hasLegacyManifest) {
    throw new Error(
      `Both ${byspacePath} and legacy ${legacyPath} exist. Keep only one plugin manifest.`,
    );
  }
  return hasLegacyManifest ? legacyPath : byspacePath;
}

export async function readPluginManifest(directory: string): Promise<PluginManifest> {
  const manifestPath = await resolvePluginManifestPath(directory);
  const info = await stat(manifestPath).catch(() => null);
  if (!info?.isFile()) throw new Error(`Plugin manifest is missing: ${manifestPath}`);
  return PluginManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
}
