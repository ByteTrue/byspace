import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export function extractApksignerCertificateSha256(output) {
  const signerCount = output.match(/^Number of signers:\s*(\d+)\s*$/m);
  if (!signerCount || signerCount[1] !== "1") {
    throw new Error("Expected apksigner output for exactly one signer");
  }

  const digests = new Set(
    [...output.matchAll(/^.*Signer.*certificate SHA-256 digest:\s*([0-9a-f]{64})\s*$/gim)].map(
      (match) => match[1].toLowerCase(),
    ),
  );
  if (digests.size !== 1) {
    throw new Error(`Expected one unique signer certificate SHA-256 digest, found ${digests.size}`);
  }

  return [...digests][0];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: node scripts/apksigner-certificate-sha256.mjs <apksigner-output-file>");
    process.exitCode = 2;
  } else {
    try {
      console.log(extractApksignerCertificateSha256(readFileSync(input, "utf8")));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
