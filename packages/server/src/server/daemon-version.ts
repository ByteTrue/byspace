import { resolvePackageVersion } from "./package-version.js";

const SERVER_PACKAGE_NAME = "@bytetrue/server";

export function resolveDaemonVersion(moduleUrl: string = import.meta.url): string {
  return resolvePackageVersion({
    moduleUrl,
    packageName: SERVER_PACKAGE_NAME,
  });
}
