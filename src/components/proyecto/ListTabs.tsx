import Link from "next/link";

// Tabs minimalistas para listados (Cotizaciones, Proyectos).
// Activo = subrayado + texto gray-900. Inactivo = texto gray-500.

export type Tab = {
  key: string;
  label: string;
  count: number;
};

export default function ListTabs({
  tabs,
  activeKey,
  basePath,
  param = "tab",
}: {
  tabs: Tab[];
  activeKey: string;
  basePath: string; // ej: "/cotizaciones"
  param?: string;
}) {
  return (
    <div className="flex items-center gap-6 border-b border-gray-200 mb-4">
      {tabs.map((t) => {
        const isActive = t.key === activeKey;
        const href = `${basePath}?${param}=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            className={`pb-2 text-sm font-medium transition-colors -mb-px border-b-2 ${
              isActive
                ? "text-gray-900 border-gray-900"
                : "text-gray-500 border-transparent hover:text-gray-700"
            }`}
          >
            {t.label}{" "}
            <span
              className={`text-xs tabular-nums ${
                isActive ? "text-gray-500" : "text-gray-400"
              }`}
            >
              ({t.count})
            </span>
          </Link>
        );
      })}
    </div>
  );
}
