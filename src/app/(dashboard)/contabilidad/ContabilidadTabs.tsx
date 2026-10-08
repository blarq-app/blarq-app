"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { name: "F29", href: "/contabilidad/f29" },
  { name: "Gastos", href: "/contabilidad/gastos" },
  { name: "Remuneraciones", href: "/contabilidad/remuneraciones" },
  { name: "Previred", href: "/contabilidad/previred" },
  { name: "Cartola", href: "/contabilidad/cartola" },
  { name: "Rendiciones", href: "/contabilidad/rendiciones" },
];

export default function ContabilidadTabs() {
  const pathname = usePathname();
  const activoRef = useRef<HTMLAnchorElement>(null);
  // En el celular, la pestaña abierta puede quedar fuera de la vista (las
  // últimas): se desliza la barra hasta ella.
  useEffect(() => {
    activoRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  // Con seis pestañas la barra no cabe en un celular (390px): se desliza de
  // lado en vez de ensanchar la página. El -mb-px va en la fila de adentro
  // (no en cada pestaña) para que la línea de la pestaña activa siga tapando
  // el borde gris sin que el deslizado la recorte.
  return (
    <div className="border-b border-gray-200 mb-6">
      <div className="flex items-center gap-1 overflow-x-auto -mb-px">
        {TABS.map((t) => {
          const activo = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              ref={activo ? activoRef : undefined}
              className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
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
    </div>
  );
}
