// Muted tones with even contrast against the white letter rendered on top.
// Order is load-bearing: derived identities index this array.
export const IDENTITY_COLOR_NAMES = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const;

export type IdentityColorName = (typeof IDENTITY_COLOR_NAMES)[number];

const IDENTITY_COLORS: Record<IdentityColorName, string> = {
  violet: "#7a6aa8",
  sky: "#3d7ea6",
  emerald: "#388068",
  orange: "#a4673a",
  pink: "#b05c80",
  indigo: "#6a70b8",
  teal: "#368080",
  red: "#b06260",
  amber: "#8f7838",
  blue: "#5179b0",
};

const IDENTITY_FOREGROUND_LIGHT: Record<IdentityColorName, string> = {
  violet: "#6d49b5",
  sky: "#3d6985",
  emerald: "#3e6e5d",
  orange: "#845838",
  pink: "#974168",
  indigo: "#5251c2",
  teal: "#3e6d6c",
  red: "#9c4243",
  amber: "#716239",
  blue: "#39649e",
};

const IDENTITY_FOREGROUND_DARK: Record<IdentityColorName, string> = {
  violet: "#a392d5",
  sky: "#6aa6ce",
  emerald: "#6cae96",
  orange: "#cc8f64",
  pink: "#d87da3",
  indigo: "#9299d5",
  teal: "#6cacab",
  red: "#d88381",
  amber: "#b29d64",
  blue: "#7ba1d5",
};

export function identityColor(name: IdentityColorName): string {
  return IDENTITY_COLORS[name];
}

export function identityForeground(name: IdentityColorName, colorScheme: "light" | "dark"): string {
  return colorScheme === "light" ? IDENTITY_FOREGROUND_LIGHT[name] : IDENTITY_FOREGROUND_DARK[name];
}

export function identityTint(name: IdentityColorName): string {
  return `${IDENTITY_COLORS[name]}1a`;
}

function hashIdentityKey(key: string): number {
  let hash = 0;
  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function deriveIdentityColorName(key: string): IdentityColorName {
  return IDENTITY_COLOR_NAMES[hashIdentityKey(key) % IDENTITY_COLOR_NAMES.length];
}
