"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { Glyph } from "@/components/ui/Glyph";

export default function Header() {
  const { data: session } = useSession();

  return (
    // `pl-14` en mobile deja libre el hueco del botón de menú, que es fixed y
    // mide 56px de ancho (ver Sidebar.tsx). En md+ el sidebar es fijo y ese
    // botón no existe, así que el padding vuelve al normal.
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 md:px-8 pl-14 md:pl-8">
      <div />
      <div className="flex items-center gap-1 md:gap-4">
        {session?.user && (
          <>
            {/*
              En mobile el nombre se reemplaza por un ícono de cuenta: escrito
              entero quedaba pegado a "Salir" con ~4px de separación y era muy
              fácil tocar el que no era — cerrar sesión sin querer. En md+
              vuelve el nombre, que es lo que había.
            */}
            <Link
              href="/cuenta"
              className="md:hidden w-11 h-11 flex items-center justify-center text-gray-600 hover:text-gray-900"
              aria-label="Mi cuenta"
            >
              <Glyph name="cuenta" size={20} />
            </Link>
            <Link
              href="/cuenta"
              className="hidden md:block text-sm text-gray-600 hover:text-gray-900 transition-colors"
              title="Mi cuenta"
            >
              {session.user.name}
            </Link>
            <button
              onClick={() => signOut()}
              className="min-h-11 md:min-h-0 px-2 md:px-0 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Salir
            </button>
          </>
        )}
      </div>
    </header>
  );
}
