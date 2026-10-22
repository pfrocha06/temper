import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGate } from "@/components/auth-gate";
import { EnvironmentProvider } from "@/hooks/use-environment";
import { ProjectProvider } from "@/hooks/use-project";
import { ThemeProvider } from "@/hooks/use-theme";
import { ApiError } from "@/lib/api";
import { App } from "./app";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live updates invalidate queries; polling is only the fallback.
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // A 4xx will not fix itself; an unreachable server might.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 3,
      retryDelay: (n) => Math.min(1000 * 2 ** n, 10_000),
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TooltipProvider>
            <AuthGate>
              <EnvironmentProvider>
                <ProjectProvider>
                  <App />
                </ProjectProvider>
              </EnvironmentProvider>
            </AuthGate>
          </TooltipProvider>
        </BrowserRouter>
        <Toaster position="bottom-right" />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
