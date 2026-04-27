"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "presupuesto", label: "Presupuesto" },
  { key: "estados-pago", label: "Estados de Pago" },
  { key: "facturas", label: "Facturas" },
  { key: "lista-compra", label: "Lista de compra" },
] as const;

export default function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  // Tab activa = primer segmento después de /proyectos/[id]/
  // Ej: /proyectos/abc/presupuesto/cm123 → "presupuesto"
  const segments = pathname.split("/").filter(Boolean);
  const ix = segments.indexOf("proyectos");
  const currentTab = ix >= 0 && segments[ix + 2] ? segments[ix + 2] : "resumen";

  return (
    <div className="flex items-center gap-1 -mb-px overflow-x-auto">
      {TABS.map((t) => {
        const isActive = currentTab === t.key;
        return (
          <Link
            key={t.key}
            href={`/proyectos/${projectId}/${t.key}`}
            className={`px-3 py-2 text-sm transition-colors whitespace-nowrap border-b-2 ${
              isActive
                ? "border-gray-900 text-gray-900 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
