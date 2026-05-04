"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export default function Header() {
  const { data: session } = useSession();

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8">
      <div />
      <div className="flex items-center gap-4">
        {session?.user && (
          <>
            <Link
              href="/cuenta"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              title="Mi cuenta"
            >
              {session.user.name}
            </Link>
            <button
              onClick={() => signOut()}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Salir
            </button>
          </>
        )}
      </div>
    </header>
  );
}
