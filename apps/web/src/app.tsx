import { lazy, type ComponentType } from "react";
import { Link, Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/shell/app-shell";
import { SettingsLayout } from "@/features/settings/settings-layout";

// Pages load on first visit; the shell and data layer are in the entry chunk.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const BoardPage = page(() => import("@/features/board/board-page"), "BoardPage");
const TicketPage = page(() => import("@/features/ticket/ticket-page"), "TicketPage");
const RunsPage = page(() => import("@/features/runs/runs-page"), "RunsPage");
const InboxPage = page(() => import("@/features/inbox/inbox-page"), "InboxPage");
const ThermostatPage = page(() => import("@/features/thermostat/thermostat-page"), "ThermostatPage");
const AgentsPage = page(() => import("@/features/agents/agents-page"), "AgentsPage");
const SkillsPage = page(() => import("@/features/skills/skills-page"), "SkillsPage");
const ChiefPage = page(() => import("@/features/chief/chief-page"), "ChiefPage");
const KnowledgePage = page(() => import("@/features/knowledge/knowledge-page"), "KnowledgePage");
const UsagePage = page(() => import("@/features/usage/usage-page"), "UsagePage");
const ToolsPage = page(() => import("@/features/settings/tools-page"), "ToolsPage");
const ProvidersPage = page(() => import("@/features/settings/providers-page"), "ProvidersPage");

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/chief" replace />} />
        <Route path="chief" element={<ChiefPage />} />
        <Route path="chief/:chatId" element={<ChiefPage />} />
        <Route path="knowledge" element={<KnowledgePage />} />
        <Route path="knowledge/:id" element={<KnowledgePage />} />
        <Route path="tools" element={<Navigate to="/settings/tools" replace />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="/settings/providers" replace />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="tools" element={<ToolsPage />} />
        </Route>
        <Route path="board" element={<BoardPage />} />
        <Route path="tickets/:id" element={<TicketPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:dispatchId" element={<RunsPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="thermostat" element={<ThermostatPage />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="p-6 text-sm">
      <h1 className="text-lg font-semibold">No such page</h1>
      <p className="mt-1 text-muted-foreground">
        Go to the{" "}
        <Link to="/board" className="text-primary underline underline-offset-2">
          board
        </Link>
        .
      </p>
    </div>
  );
}
