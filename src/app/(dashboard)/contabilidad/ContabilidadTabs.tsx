"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { name: "F29", href: "/contabilidad/f29" },
  { name: "Gastos", href: "/contabilidad/gastos" },
  { name: "Remuneraciones", href: "/contabilidad/remuneraciones" },
  { name: "Previred", href: "/contabilidad/previred" },
];

export default function ContabilidadTabs() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 border-b border-gray-200 mb-6">
      {TABS.map((t) => {
        const activo = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              activo
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            {t.name}
          </Link>
        );
      })}
    </div>
  );
}
