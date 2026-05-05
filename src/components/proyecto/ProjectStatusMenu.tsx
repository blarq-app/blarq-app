"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// Menú "..." al lado de "Editar datos" en el header del proyecto.
// Permite cambiar el estado del proyecto sin entrar al form de edición:
//   - ejecucion → terminado ("Marcar como terminado")
//   - terminado → ejecucion ("Reabrir proyecto")
// Estados cotizacion y archivado no exponen acción acá (se manejan
// desde el form de edición o flujos específicos).
//
// El botón solo se renderiza si hay una acción que ofrecer — para no
// dejar un "..." vacío que confunda.

type Props = {
  projectId: string;
  projectName: string;
  status: string;
};

type Action = {
  label: string;
  newStatus: string;
  // Texto del confirm() nativo. Castellano simple.
  confirmText: string;
};

function actionFor(status: string, projectName: string): Action | null {
  if (status === "ejecucion") {
    return {
      label: "Marcar como terminado",
      newStatus: "terminado",
      confirmText: `¿Marcar "${projectName}" como terminado? Va a salir de la lista activa.`,
    };
  }
  if (status === "terminado") {
    return {
      label: "Reabrir proyecto",
      newStatus: "ejecucion",
      confirmText: `¿Reabrir "${projectName}"? Va a volver a la lista de proyectos en ejecución.`,
    };
  }
  return null;
}

export default function ProjectStatusMenu({ projectId, projectName, status }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState<{ top: number; right: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const action = actionFor(status, projectName);

  // Cerrar el menú al hacer click fuera (botón o dropdown).
  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function onScrollOrResize() { setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  // Si no hay acción aplicable al estado actual, no mostramos el botón.
  if (!action) return null;

  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    // Calculamos posición del dropdown en coordenadas de viewport para
    // poder usar position:fixed. Esto evita que el menú quede recortado
    // por contenedores ancestrales con overflow:hidden (típico en la
    // tabla de proyectos, que tiene rounded-xl + overflow-hidden).
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(true);
  }

  async function handleClick() {
    if (!action) return;
    setOpen(false);
    if (!window.confirm(action.confirmText)) return;
    setPending(true);
    try {
      const res = await fetch(`/api/proyectos/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action.newStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert(body?.error || "No se pudo cambiar el estado del proyecto.");
        return;
      }
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Más acciones"
        // Botón sutil: sin borde, icono gris claro. Al hover se enfatiza
        // levemente (fondo gris + icono más oscuro). Pensado para que no
        // compita visualmente con acciones primarias del header/tabla.
        className="p-1.5 rounded text-gray-300 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 flex-shrink-0"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
        </svg>
      </button>
      {open && menuPos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
          className="w-56 bg-white rounded-lg shadow-sm border border-gray-200 py-1 z-50"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleClick}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {action.label}
          </button>
        </div>
      )}
    </>
  );
}
