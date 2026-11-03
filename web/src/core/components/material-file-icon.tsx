import type { ComponentType } from "react";
import { getFileIconSvg } from "@/components/file-icon-svg";
import type { PanelIconProps } from "@/panels/panel-registry";
import { SvgXml } from "~/components/svg-xml";

export function MaterialFileIcon({ fileName, size }: { fileName: string; size: number }) {
  return <SvgXml xml={getFileIconSvg(fileName)} width={size} height={size} />;
}

export function createMaterialFileIcon(fileName: string): ComponentType<PanelIconProps> {
  function BoundMaterialFileIcon({ size }: PanelIconProps) {
    return <MaterialFileIcon fileName={fileName} size={size} />;
  }
  return BoundMaterialFileIcon;
}
