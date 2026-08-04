"use client";

// Botón "Limpiar" de la barra de filtros de /banco/movimientos: deja la
// pantalla como recién entrada (cuenta, estado, respaldo, tipo, búsqueda,
// monto, obra, imputación y filtros avanzados, todos en su default).
//
// POR QUÉ recarga la página en vez de usar <Link>: tres de los controles de la
// barra son componentes con estado propio —el buscador de texto
// (MovementsSearch), el de monto (MovementsMontoSearch) y el panel de filtros
// avanzados—, y una navegación normal de Next no los vuelve a montar: la URL
// quedaría limpia pero el texto seguiría escrito en la caja. Peor: el buscador
// re-navega 300ms después de cualquier cambio, así que volvería a aplicar el
// filtro que acabamos de sacar. Recargar es el único reset que no deja
// migajas, y es una acción esporádica: no vale la pena sincronizar el estado
// de cada input contra la URL (y arriesgar que se coma letras mientras MJ
// escribe) para ahorrarse una recarga.
export default function LimpiarFiltrosButton({
  className = "",
}: {
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = "/banco/movimientos";
      }}
      className={`text-xs text-gray-500 hover:text-gray-900 underline ${className}`}
    >
      Limpiar
    </button>
  );
}
