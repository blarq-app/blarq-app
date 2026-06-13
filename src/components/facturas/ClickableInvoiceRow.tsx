"use client";

import { useRouter } from "next/navigation";

// Fila de tabla que navega al detalle de la factura con un click en
// cualquier parte. Existe porque el link solo en el folio era invisible:
// MJ no encontraba cómo entrar a la factura desde la lista del proyecto.
//
// Reglas para no romper la edición inline que vive adentro de la fila
// (mover de proyecto, categoría editable, links de referencia):
// - si el click cae sobre un elemento interactivo, no navegamos;
// - si hay texto seleccionado (copiar folio/monto), tampoco.
export default function ClickableInvoiceRow({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  function handleClick(e: React.MouseEvent<HTMLTableRowElement>) {
    const target = e.target as HTMLElement;
    if (
      target.closest("a, button, select, input, textarea, label, [role='button']")
    ) {
      return;
    }
    if (window.getSelection()?.toString()) return;
    router.push(href);
  }

  return (
    <tr onClick={handleClick} className="hover:bg-gray-50 cursor-pointer">
      {children}
    </tr>
  );
}
