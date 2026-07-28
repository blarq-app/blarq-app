"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navigation = [
  { name: "Dashboard", href: "/", icon: "📊" },
  { name: "Cotizaciones", href: "/cotizaciones", icon: "📝" },
  { name: "Proyectos", href: "/proyectos", icon: "🏗️" },
  { name: "Facturas", href: "/facturas", icon: "💵" },
  { name: "Banco", href: "/banco", icon: "🏦" },
  { name: "Contabilidad", href: "/contabilidad", icon: "🧾" },
  { name: "Partidas", href: "/catalogo/partidas", icon: "📋" },
  { name: "Materiales", href: "/catalogo/materiales", icon: "🧱" },
  { name: "Artefactos", href: "/catalogo/artefactos", icon: "🚿" },
  { name: "Herrajes", href: "/catalogo/herrajes", icon: "🔩" },
  { name: "Reembolsadores", href: "/configuracion/reembolsadores", icon: "🔄" },
  { name: "Auditoría precios", href: "/configuracion/auditoria-precios", icon: "🔍" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cerrar el drawer al navegar (mobile UX)
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Hamburger button — solo visible en mobile, fixed top-left */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-30 bg-gray-900 text-white p-2 rounded-lg shadow-lg"
        aria-label="Abrir menú"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Overlay — solo en mobile cuando está abierto */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`w-64 bg-gray-900 text-white min-h-screen flex flex-col fixed md:static inset-y-0 left-0 z-50 transition-transform ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="p-6 border-b border-gray-700 flex items-center justify-between">
          {/*
            El logo maestro es tinta oscura sobre transparente, así que acá van las
            versiones en blanco horneadas por scripts/generar-logo-assets.py.
            El isotipo y el bloque BLARQ son dos imágenes separadas a propósito:
            así el isotipo puede crecer sin arrastrar al texto.
          */}
          <div className="flex items-center gap-3">
            <Image
              src="/assets/blarq-isotipo-blanco.png"
              alt=""
              width={256}
              height={283}
              className="w-9 h-auto shrink-0"
              priority
            />
            <div>
              <Image
                src="/assets/blarq-wordmark-blanco.png"
                alt="BLARQ"
                width={720}
                height={136}
                className="w-28 h-auto"
                priority
              />
              <p className="text-gray-400 text-xs mt-1.5">Gestión de Obras</p>
            </div>
          </div>
          {/* Close button — solo en mobile */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-gray-400 hover:text-white p-1"
            aria-label="Cerrar menú"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navigation.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gray-700 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-700">
          <p className="text-gray-500 text-xs">BLARQ v0.1</p>
        </div>
      </aside>
    </>
  );
}
