import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parsePackedFilename } from "./pack-byspace-output.mjs";

describe("parsePackedFilename", () => {
  it("reads npm 10 array output", () => {
    assert.equal(
      parsePackedFilename(
        JSON.stringify([{ filename: "bytetrue-byspace-0.1.1.tgz" }]),
        "@bytetrue/byspace",
      ),
      "bytetrue-byspace-0.1.1.tgz",
    );
  });

  it("reads npm 12 package-keyed output", () => {
    assert.equal(
      parsePackedFilename(
        JSON.stringify({
          "@bytetrue/byspace": { filename: "bytetrue-byspace-0.1.1.tgz" },
        }),
        "@bytetrue/byspace",
      ),
      "bytetrue-byspace-0.1.1.tgz",
    );
  });

  it("rejects output without the requested package", () => {
    assert.throws(
      () => parsePackedFilename("{}", "@bytetrue/byspace"),
      /npm pack returned no filename/,
    );
  });
});
