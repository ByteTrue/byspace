import { BYSPACE_LOGO_PATH, BYSPACE_LOGO_VIEWBOX } from "@/components/icons/byspace-logo-path";

export function BySpaceLogo({ className }: { className?: string }) {
  return (
    <svg viewBox={BYSPACE_LOGO_VIEWBOX} fill="none" className={className} aria-hidden="true">
      <path d={BYSPACE_LOGO_PATH} fill="currentColor" />
    </svg>
  );
}
