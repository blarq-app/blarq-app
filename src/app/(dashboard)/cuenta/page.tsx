import { auth } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import ChangePasswordForm from "@/components/account/ChangePasswordForm";
import { Glyph } from "@/components/ui/Glyph";

export default async function CuentaPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <Link
          href="/configuracion"
          className="inline-flex items-center gap-1 -ml-1 min-h-11 md:min-h-0 py-1 text-xs text-gray-500 hover:text-gray-900"
        >
          <Glyph name="chevron-left" size={14} />
          Configuración
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Mi cuenta</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Datos personales
        </h2>
        {/*
          En mobile el rótulo va ARRIBA del dato, no al lado. Con `grid-cols-3`
          fijo, en un celular de 375px la columna del valor quedaba en ~200px y
          un email largo se partía contra el borde. `break-words` para que corte
          por dentro si igual no entra.
        */}
        <dl className="space-y-3 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-y-2 text-sm">
          <dt className="text-gray-500">Nombre</dt>
          <dd className="sm:col-span-2 text-gray-900 break-words">
            {session.user.name}
          </dd>
          <dt className="text-gray-500">Email</dt>
          <dd className="sm:col-span-2 text-gray-900 break-words">
            {session.user.email}
          </dd>
        </dl>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Cambiar contraseña
        </h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
