import assert from "node:assert/strict";
import test from "node:test";
import { extractApksignerCertificateSha256 } from "./apksigner-certificate-sha256.mjs";

const fingerprint = "9994bc2c7106a7245dd7f8f15d058653de8bfe896388decda43239271c685796";

test("extracts the current apksigner V2 certificate digest", () => {
  assert.equal(
    extractApksignerCertificateSha256(`
V2 Signer: certificate SHA-256 digest: ${fingerprint}
Number of signers: 1
`),
    fingerprint,
  );
});

test("accepts the legacy apksigner signer label", () => {
  assert.equal(
    extractApksignerCertificateSha256(`
Signer #1 certificate SHA-256 digest: ${fingerprint.toUpperCase()}
Number of signers: 1
`),
    fingerprint,
  );
});

test("rejects multiple signers", () => {
  assert.throws(
    () =>
      extractApksignerCertificateSha256(`
V2 Signer: certificate SHA-256 digest: ${fingerprint}
Number of signers: 2
`),
    /exactly one signer/,
  );
});
