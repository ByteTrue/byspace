// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentMetadata } from "@/attachments/types";
import { AttachmentLightbox, type ImageLightboxSource } from "./attachment-lightbox";

const { theme, imageMetadata, useAttachmentPreviewUrlMock } = vi.hoisted(() => {
  const hoistedTheme = {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    iconSize: { sm: 14, md: 18, lg: 22 },
    borderWidth: { 1: 1 },
    borderRadius: { full: 999, md: 6, lg: 8 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400" },
    colors: {
      surface1: "#111",
      surface2: "#222",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      borderAccent: "#444",
    },
  };

  const hoistedImageMetadata: AttachmentMetadata = {
    id: "img-1",
    mimeType: "image/png",
    storageType: "web-indexeddb",
    storageKey: "img-1",
    fileName: "img-1.png",
    byteSize: 42,
    createdAt: 1,
  };

  return {
    theme: hoistedTheme,
    imageMetadata: hoistedImageMetadata,
    useAttachmentPreviewUrlMock: vi.fn<(metadata: AttachmentMetadata | null) => string | null>(
      () => "blob:preview",
    ),
  };
});
const attachmentSource: ImageLightboxSource = { type: "attachment", metadata: imageMetadata };
const assistantImageSource: ImageLightboxSource = {
  type: "uri",
  uri: "blob:assistant-image",
};

vi.mock("~/app/theme-object", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/app/theme-object")>()),
  useThemeObject: () => theme,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "message.attachments.closeImage": "Close image",
        "message.attachments.dismissImage": "Dismiss image",
        "message.attachments.imageLoadFailed": "Couldn't load image",
      })[key] ?? key,
  }),
}));

vi.mock("lucide-react", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return {
    X: createIcon("X"),
  };
});

vi.mock("@/components/zoomable-viewport/image", () => ({
  ZoomableImage: (props: Record<string, unknown>) => {
    const actions = props.actions as Array<{
      label: string;
      onPress: () => void;
      testID?: string;
    }>;
    return React.createElement(
      "div",
      {
        "data-testid": `${String(props.testID)}-image`,
        "data-source": props.uri,
        role: "img",
      },
      actions.map((action) =>
        React.createElement(
          "button",
          {
            "aria-label": action.label,
            "data-testid": action.testID,
            key: action.label,
            onClick: action.onPress,
            type: "button",
          },
          action.label,
        ),
      ),
    );
  },
}));

vi.mock("@/attachments/use-attachment-preview-url", () => ({
  useAttachmentPreviewUrl: (metadata: AttachmentMetadata | null) =>
    useAttachmentPreviewUrlMock(metadata),
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useAttachmentPreviewUrlMock.mockReturnValue("blob:preview");
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function render(element: React.ReactElement) {
  act(() => {
    root?.render(element);
  });
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

function queryByTestId(testID: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testID}"]`);
}

describe("AttachmentLightbox", () => {
  it("renders nothing when the source is null", () => {
    render(<AttachmentLightbox source={null} onClose={vi.fn()} />);

    expect(queryByTestId("attachment-lightbox-image")).toBeNull();
  });

  it("renders the image when metadata is provided", () => {
    render(<AttachmentLightbox source={attachmentSource} onClose={vi.fn()} />);

    const image = queryByTestId("attachment-lightbox-image");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("data-source")).toBe("blob:preview");
  });

  it("renders a direct timeline image without resolving attachment storage", () => {
    render(<AttachmentLightbox source={assistantImageSource} onClose={vi.fn()} />);

    const image = queryByTestId("attachment-lightbox-image");
    expect(image?.getAttribute("data-source")).toBe("blob:assistant-image");
    expect(useAttachmentPreviewUrlMock).toHaveBeenLastCalledWith(null);
  });

  it("calls onClose when the close button is pressed", () => {
    const onClose = vi.fn();
    render(<AttachmentLightbox source={attachmentSource} onClose={onClose} />);

    const closeButton = document.querySelector(
      '[aria-label="Close image"][data-testid="attachment-lightbox-close"]',
    );
    expect(closeButton).not.toBeNull();
    click(closeButton!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows error text when the preview URL resolves to null", () => {
    useAttachmentPreviewUrlMock.mockReturnValue(null);
    render(<AttachmentLightbox source={attachmentSource} onClose={vi.fn()} />);

    expect(queryByTestId("attachment-lightbox-image")).toBeNull();
    expect(document.body.textContent ?? "").toContain("Couldn't load image");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<AttachmentLightbox source={attachmentSource} onClose={onClose} />);

    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
