"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Glyph } from "@/components/ui/Glyph";

/**
 * Navegación agrupada en tres bloques. Antes era una lista plana de 12 ítems
 * con un emoji cada uno; en el celular eso es una tira larga sin jerarquía en
 * la que hay que buscar leyendo. Los grupos permiten ubicarse por zona
 * ("esto es catálogo") antes de leer cada nombre.
 *
 * Los íconos son SVG monocromáticos (ver ui/Glyph.tsx). Los emojis que había
 * (📊 📝 🏗️ 💵 🏦 🧾 📋 🧱 🚿 🔩 🔄 🔍) están prohibidos por
 * docs/principles.md — "los emojis rompen el tono editorial sobrio".
 *
 * Las dos pantallas de configuración que colgaban sueltas al final del menú
 * (Reembolsadores, Auditoría de precios) ahora viven detrás de una sola
 * entrada, Configuración, que es el hub de /configuracion.
 */
const navGroups: {
  label: string | null;
  items: { name: string; href: string; icon: string }[];
}[] = [
  {
    label: null,
    items: [
      { name: "Dashboard", href: "/", icon: "dashboard" },
      { name: "Cotizaciones", href: "/cotizaciones", icon: "cotizaciones" },
      { name: "Proyectos", href: "/proyectos", icon: "proyectos" },
      { name: "Facturas", href: "/facturas", icon: "facturas" },
      { name: "Banco", href: "/banco", icon: "banco" },
      { name: "Contabilidad", href: "/contabilidad", icon: "contabilidad" },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { name: "Partidas", href: "/catalogo/partidas", icon: "partidas" },
      { name: "Materiales", href: "/catalogo/materiales", icon: "materiales" },
      { name: "Artefactos", href: "/catalogo/artefactos", icon: "artefactos" },
      { name: "Herrajes", href: "/catalogo/herrajes", icon: "herrajes" },
    ],
  },
  {
    label: "Ajustes",
    items: [
      { name: "Configuración", href: "/configuracion", icon: "configuracion" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cerrar el drawer al navegar (mobile UX)
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Con el drawer abierto se bloquea el scroll del fondo. Sin esto, en el
  // celular el dedo scrollea la página de atrás en vez del menú y la lista
  // parece trabada.
  useEffect(() => {
    if (!mobileOpen) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, [mobileOpen]);

  // Cerrar con Escape (teclado físico en tablet/desktop angosto).
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <>
      {/*
        Botón de menú — solo mobile. Antes era un cuadrado negro flotante con
        shadow-lg encima del contenido; la guía de marca permite shadow-sm como
        máximo. Ahora es un botón plano alineado con el alto del header (h-16),
        así se lee como parte del header y no como algo pegado arriba.
      */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-0 left-0 z-30 h-16 w-14 flex items-center justify-center text-gray-600 hover:text-gray-900"
        aria-label="Abrir menú"
        aria-expanded={mobileOpen}
      >
        <Glyph name="menu" size={22} />
      </button>

      {/* Overlay — solo en mobile cuando está abierto */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`w-72 md:w-64 bg-gray-900 text-white min-h-screen max-h-screen md:max-h-none flex flex-col fixed md:static inset-y-0 left-0 z-50 transition-transform ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="p-6 border-b border-gray-700 flex items-start justify-between shrink-0">
          {/*
            El logo maestro es tinta oscura sobre transparente, así que acá van las
            versiones claras horneadas por scripts/generar-logo-assets.py (en Lino,
            no en blanco: el blanco sobre este fondo queda duro y fuera de paleta).
            BLARQ y la bajada son dos imágenes separadas a propósito: llevan
            jerarquía distinta, la bajada va más chica y atenuada.
          */}
          <div>
            <Image
              src="/assets/blarq-wordmark-claro.png"
              alt="BLARQ"
              width={720}
              height={136}
              className="w-32 h-auto"
              priority
            />
            <Image
              src="/assets/blarq-bajada-claro.png"
              alt="Blanco Larraín Arquitectos"
              width={720}
              height={36}
              className="w-32 h-auto mt-2 opacity-60"
              priority
            />
            <p className="text-gray-400 text-xs mt-3">Gestión de Obras</p>
          </div>
          {/* Cerrar — solo en mobile. 44px de lado: es el mínimo táctil. */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden -mr-2 -mt-2 w-11 h-11 flex items-center justify-center text-gray-400 hover:text-white"
            aria-label="Cerrar menú"
          >
            <Glyph name="close" size={20} />
          </button>
        </div>

        {/*
          overflow-y-auto: en un celular chico (iPhone SE, 667px de alto) los 11
          ítems más el logo no entran, y sin scroll propio los últimos quedaban
          fuera de pantalla sin forma de llegar.
        */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-5">
          {navGroups.map((group, gi) => (
            <div key={group.label ?? `grupo-${gi}`} className="space-y-1">
              {group.label && (
                <p className="px-4 pb-1 text-[10px] font-medium uppercase tracking-widest text-gray-500">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-gray-700 text-white"
                        : "text-gray-300 hover:bg-gray-800 hover:text-white"
                    }`}
                  >
                    <Glyph
                      name={item.icon}
                      size={18}
                      className={isActive ? "text-white" : "text-gray-400"}
                    />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/*
          pb con safe-area: en iPhone con barra de gestos, el último renglón
          queda debajo de la barra y no se lee.
        */}
        <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-700 shrink-0">
          <p className="text-gray-500 text-xs">BLARQ v0.1</p>
        </div>
      </aside>
    </>
  );
}
