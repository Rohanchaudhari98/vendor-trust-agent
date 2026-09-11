import { Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { OverviewPage } from "./pages/OverviewPage";
import { VendorsPage } from "./pages/VendorsPage";
import { CheckDetailPage } from "./pages/CheckDetailPage";
import { ObservabilityPage } from "./pages/ObservabilityPage";
import { CopilotProvider } from "./components/copilot/CopilotContext";
import { CopilotPanel } from "./components/copilot/CopilotPanel";
import { FloatingCopilotButton } from "./components/copilot/FloatingCopilotButton";

export default function App() {
  return (
    <CopilotProvider>
      <div className="flex h-screen w-full overflow-hidden bg-[var(--color-surface)]">
        <Sidebar />
        <main className="relative flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            {/* Old "Checks" tab removed — reports live on Home; keep URL redirect */}
            <Route path="/checks" element={<Navigate to="/" replace />} />
            <Route path="/checks/:id" element={<CheckDetailPage />} />
            <Route path="/vendors" element={<VendorsPage />} />
            {/* Ask AI is now the floating panel — old route opens Home */}
            <Route path="/copilot" element={<Navigate to="/" replace />} />
            <Route path="/observability" element={<ObservabilityPage />} />
          </Routes>
          <FloatingCopilotButton />
          <CopilotPanel />
        </main>
      </div>
    </CopilotProvider>
  );
}
