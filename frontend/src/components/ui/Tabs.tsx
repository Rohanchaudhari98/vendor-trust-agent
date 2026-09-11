export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-slate-300">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative px-4 py-2.5 text-sm font-semibold transition-colors ${
            active === tab.id ? "text-blue-700" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {tab.label}
          {active === tab.id && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600" />
          )}
        </button>
      ))}
    </div>
  );
}
