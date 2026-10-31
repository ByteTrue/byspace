// Transitional stand-in for `expo-constants`: shared code only reads the app version from it,
// and falls back to packages/app/package.json first. Deleted at the cutover.
interface ExpoConstants {
  expoConfig: { version?: string } | null;
  manifest: { version?: string } | null;
}

const Constants: ExpoConstants = { expoConfig: null, manifest: null };
export default Constants;
