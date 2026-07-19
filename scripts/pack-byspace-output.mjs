export function parsePackedFilename(output, packageName) {
  const result = JSON.parse(output);
  const packed = Array.isArray(result) ? result[0] : result[packageName];
  if (typeof packed?.filename !== "string") {
    throw new Error(`npm pack returned no filename for ${packageName}`);
  }
  return packed.filename;
}
