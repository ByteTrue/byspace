import { afterEach, describe, expect, it } from "vitest";
import { browserOriginHost } from "./use-is-local-daemon";

interface WindowStub {
  window?: { location?: Partial<Location> } | undefined;
}

const globalWithWindow = globalThis as unknown as WindowStub;
const originalWindow = globalWithWindow.window;

function setLocation(location: Partial<Location>): void {
  globalWithWindow.window = { location };
}

afterEach(() => {
  globalWithWindow.window = originalWindow;
});

describe("browserOriginHost", () => {
  it("returns null when window is unavailable", () => {
    delete globalWithWindow.window;
    expect(browserOriginHost()).toBeNull();
  });

  it("passes through origins with an explicit port", () => {
    setLocation({ host: "localhost:8081", port: "8081", protocol: "http:" });
    expect(browserOriginHost()).toBe("localhost:8081");
  });

  it("re-attaches the default https port that location.host omits", () => {
    setLocation({ host: "app.byspace.cc.cd", port: "", protocol: "https:" });
    expect(browserOriginHost()).toBe("app.byspace.cc.cd:443");
  });

  it("re-attaches the default http port that location.host omits", () => {
    setLocation({ host: "app.byspace.cc.cd", port: "", protocol: "http:" });
    expect(browserOriginHost()).toBe("app.byspace.cc.cd:80");
  });

  it("normalizes loopback hosts", () => {
    setLocation({ host: "127.0.0.1:6777", port: "6777", protocol: "http:" });
    expect(browserOriginHost()).toBe("localhost:6777");
  });
});
