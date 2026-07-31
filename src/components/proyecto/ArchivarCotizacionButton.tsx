"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Archivar / desarchivar una cotización desde la lista, sin tener que entrar
// a la cotización → "Editar datos" → cambiar el Estado (que era la única
// forma hasta julio 2026: quedaba enterrado y nadie lo encontraba).
//
// Archivar NO es borrar y por eso se ve distinto: ícono neutro gris (caja de
// archivo) contra la crucecita roja destructiva de BorrarCotizacionButton.
// Tampoco pide confirmación: es reversible con un click desde la pestaña
// "Archivadas". Borrar sí la pide, porque se lleva presupuestos y EPs.
//
// Vuelta atrás: una cotización que nunca se convirtió vuelve a "cotizacion"
// (pestaña Activas). Si en cambio ya había sido proyecto (tiene número de
// proyecto asignado), vuelve a "terminado" en vez de a cotización — no la
// reactivamos como obra viva por las dudas; para eso está "Reabrir proyecto"
// en el menú "..." de /proyectos.

export default function ArchivarCotizacionButton({
  projectId,
  projectName,
  archivada,
  numeroProyecto,
}: {
  projectId: string;
  projectName: string;
  // true = la fila está en la pestaña Archivadas (el botón desarchiva)
  archivada: boolean;
  numeroProyecto: number | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const nuevoStatus = !archivada
    ? "archivado"
    : numeroProyecto != null
      ? "terminado"
      : "cotizacion";

  const titulo = !archivada
    ? `Archivar «${projectName}» — pasa a la pestaña Archivadas`
    : numeroProyecto != null
      ? `Desarchivar «${projectName}» — vuelve a proyectos terminados`
      : `Desarchivar «${projectName}» — vuelve a la pestaña Activas`;

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(`/api/proyectos/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nuevoStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Error al cambiar el estado");
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error al cambiar el estado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={titulo}
      aria-label={titulo}
      className="text-gray-300 hover:text-gray-700 hover:bg-gray-100 w-6 h-6 rounded flex items-center justify-center transition-colors disabled:opacity-50"
    >
      <svg
        className="w-3.5 h-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* Caja de archivo: tapa + cuerpo. Común a las dos acciones. */}
        <rect x="2.5" y="3.5" width="19" height="5" rx="1" />
        <path d="M4.5 8.5v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-10" />
        {archivada ? (
          // Desarchivar: flecha saliendo hacia arriba.
          <>
            <path d="M12 18.5v-6" />
            <path d="M9.5 15l2.5-2.5 2.5 2.5" />
          </>
        ) : (
          // Archivar: la manija horizontal de la caja.
          <path d="M10 13h4" />
        )}
      </svg>
    </button>
  );
}
