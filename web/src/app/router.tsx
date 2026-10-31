import { createBrowserRouter, Outlet } from "react-router";
import { AppProviders } from "~/app/providers";
import { DebugHome } from "~/app/debug-home";

function Root() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    children: [{ index: true, element: <DebugHome /> }],
  },
]);
