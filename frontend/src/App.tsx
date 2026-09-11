import { Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { OverviewPage } from "./pages/OverviewPage";
import { VendorsPage } from "./pages/VendorsPage";
import { CheckDetailPage } from "./pages/CheckDetailPage";
import { CopilotPage } from "./pages/CopilotPage";
import { ObservabilityPage } from "./pages/ObservabilityPage";

export default function App() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-surface)]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          {/* Old "Checks" tab removed — reports live on Home; keep URL redirect */}
          <Route path="/checks" element={<Navigate to="/" replace />} />
          <Route path="/checks/:id" element={<CheckDetailPage />} />
          <Route path="/vendors" element={<VendorsPage />} />
          <Route path="/copilot" element={<CopilotPage />} />
          <Route path="/observability" element={<ObservabilityPage />} />
        </Routes>
      </main>
    </div>
  );
}
