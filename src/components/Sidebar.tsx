"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { name: "Dashboard", href: "/", icon: "📊" },
  { name: "Cotizaciones", href: "/cotizaciones", icon: "📝" },
  { name: "Proyectos", href: "/proyectos", icon: "🏗️" },
  { name: "Facturas", href: "/facturas", icon: "💵" },
  { name: "Banco", href: "/banco", icon: "🏦" },
  { name: "Partidas", href: "/catalogo/partidas", icon: "📋" },
  { name: "Materiales", href: "/catalogo/materiales", icon: "🧱" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-6 border-b border-gray-700">
        <h1 className="text-2xl font-bold tracking-tight">BLARQ</h1>
        <p className="text-gray-400 text-sm mt-1">Gestión de Obras</p>
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
  );
}
