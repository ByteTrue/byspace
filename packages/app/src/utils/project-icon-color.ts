import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";

export function deriveProjectIconColor(projectKey: string): string {
  return identityColor(deriveIdentityColorName(projectKey));
}
