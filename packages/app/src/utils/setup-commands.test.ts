import { describe, expect, test } from "vitest";
import { buildSetupCommands } from "./setup-commands";

describe("buildSetupCommands", () => {
  test("self-hosted web with a relay endpoint", () => {
    expect(
      buildSetupCommands({
        webOrigin: "http://192.168.1.10:8080",
        relayEndpoint: "relay.example.com:443",
      }),
    ).toEqual({
      installCommand: "npm install -g @bytetrue/byspace",
      onboardCommand:
        "byspace onboard --web-origin http://192.168.1.10:8080 --relay-endpoint relay.example.com:443",
    });
  });

  test("self-hosted web without a relay falls back to hosted --relay", () => {
    expect(buildSetupCommands({ webOrigin: "http://192.168.1.10:8080" })).toEqual({
      installCommand: "npm install -g @bytetrue/byspace",
      onboardCommand: "byspace onboard --web-origin http://192.168.1.10:8080 --relay",
    });
  });

  test("empty relay input is treated as absent", () => {
    expect(buildSetupCommands({ webOrigin: "https://my.web.example", relayEndpoint: "" })).toEqual({
      installCommand: "npm install -g @bytetrue/byspace",
      onboardCommand: "byspace onboard --web-origin https://my.web.example --relay",
    });
  });

  test("hosted web app needs neither --web-origin nor a relay input", () => {
    expect(buildSetupCommands({ webOrigin: null })).toEqual({
      installCommand: "npm install -g @bytetrue/byspace",
      onboardCommand: "byspace onboard --relay",
    });
  });
});
