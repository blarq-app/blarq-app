import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import ChangePasswordForm from "@/components/account/ChangePasswordForm";

export default async function CuentaPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Mi cuenta</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Datos personales
        </h2>
        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          <dt className="text-gray-500">Nombre</dt>
          <dd className="col-span-2 text-gray-900">{session.user.name}</dd>
          <dt className="text-gray-500">Email</dt>
          <dd className="col-span-2 text-gray-900">{session.user.email}</dd>
        </dl>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Cambiar contraseña
        </h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
