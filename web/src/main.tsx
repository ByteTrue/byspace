import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { bindExpoRouter } from "~/shims/expo-router";
import { router } from "~/app/router";
import "./index.css";

bindExpoRouter(router);

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing");
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
