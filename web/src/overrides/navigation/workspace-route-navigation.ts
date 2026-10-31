// Override of packages/app/src/navigation/workspace-route-navigation.ts. The Expo version pops a
// React Navigation stack so repeated hops don't pile up hidden workspace screens; React Router
// keeps no screen stack, so a workspace route is ordinary navigation.
import { router } from "expo-router";

export function registerWorkspaceRouteNavigationRef(): () => void {
  return () => {};
}

export function navigateToHostWorkspaceRoute(route: string): void {
  router.navigate(route);
}
