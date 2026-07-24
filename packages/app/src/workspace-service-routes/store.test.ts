// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceServiceRoutePreferencesStore } from "./store";

describe("workspace service route preferences", () => {
  beforeEach(() => {
    useWorkspaceServiceRoutePreferencesStore.setState({ byServerId: {} });
  });

  it("keeps the selected route independent per host", () => {
    const { setPreferredRoute } = useWorkspaceServiceRoutePreferencesStore.getState();
    setPreferredRoute("server-a", "public");
    setPreferredRoute("server-b", "direct");

    expect(useWorkspaceServiceRoutePreferencesStore.getState().byServerId).toEqual({
      "server-a": "public",
      "server-b": "direct",
    });
  });
});
