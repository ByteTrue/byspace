import assert from "node:assert/strict";
import test from "node:test";

import { extractApksignerCertificateSha256 } from "./apksigner-certificate-sha256.mjs";

const digest = "9994bc2c7106a7245dd7f8f15d058653de8bfe896388decda43239271c685796";

test("extracts the sole APK signer certificate digest", () => {
  assert.equal(
    extractApksignerCertificateSha256(
      `Signer #1 certificate SHA-256 digest: ${digest}\nNumber of signers: 1\n`,
    ),
    digest,
  );
});

test("rejects multiple signers", () => {
  assert.throws(
    () =>
      extractApksignerCertificateSha256(
        `Signer #1 certificate SHA-256 digest: ${digest}\nNumber of signers: 2\n`,
      ),
    /exactly one signer/,
  );
});
