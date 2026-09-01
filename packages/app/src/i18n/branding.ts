export function rebrandResource<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replaceAll("Paseo Hub", "__PASEO_HUB__")
      .replaceAll("PaseoApi", "__PASEO_API__")
      .replaceAll("paseo-plugin.d.ts", "byspace-plugin.d.ts")
      .replaceAll("paseo-plugin.json", "byspace-plugin.json")
      .replaceAll("paseo.json", "byspace.json")
      .replaceAll("Paseo", "BySpace")
      .replaceAll("__PASEO_API__", "PaseoApi")
      .replaceAll("__PASEO_HUB__", "Paseo Hub")
      .replaceAll("PASEO_", "BYSPACE_") as T;
  }
  if (Array.isArray(value)) {
    return value.map(rebrandResource) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rebrandResource(entry)]),
    ) as T;
  }
  return value;
}
