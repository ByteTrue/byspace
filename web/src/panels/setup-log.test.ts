import { describe, expect, it } from "vitest";
import { processCarriageReturns } from "@/panels/setup-log";

describe("processCarriageReturns", () => {
  it("keeps CRLF output instead of blanking every line", () => {
    expect(processCarriageReturns("make : not recognized\r\nExit code 1\r\n")).toBe(
      "make : not recognized\nExit code 1\n",
    );
  });

  it("collapses a redrawn progress bar to its last frame", () => {
    expect(processCarriageReturns("10%\r55%\r100%\n")).toBe("100%\n");
  });

  it("leaves plain output untouched", () => {
    expect(processCarriageReturns("plain\noutput")).toBe("plain\noutput");
  });
});
