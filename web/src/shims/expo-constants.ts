// Stand-in for `expo-constants`: src/core only reads the app version from it, and reads
// web/package.json first.
interface ExpoConstants {
  expoConfig: { version?: string } | null;
  manifest: { version?: string } | null;
}

const Constants: ExpoConstants = { expoConfig: null, manifest: null };
export default Constants;
