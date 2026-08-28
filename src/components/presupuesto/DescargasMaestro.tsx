"use client";

import { useState } from "react";

// Los dos documentos que se le mandan al maestro (PDF y Excel), con un tilde
// que decide CUÁL de las dos versiones baja:
//
//   · destildado (default) = sin precios — el alcance para que el maestro
//     cotice, con las columnas P.U. y TOTAL en blanco.
//   · tildado = con la mano de obra ya acordada escrita, para cuando el trato
//     está cerrado (`?precios=1` en el endpoint).
//
// El tilde en vez de cuatro botones lo eligió MJ sobre un mockup: la barra ya
// tiene "Descargar PDF" y cuatro botones más la dejaban ilegible.
//
// El estado del tilde es solo de esta pantalla (no se guarda): arranca siempre
// destildado, que es el documento que se manda más seguido. Como los dos
// archivos se llaman distinto (el con precios dice CON_PRECIOS en el nombre),
// un despiste en el tilde se nota antes de mandarlo.

interface DescargasMaestroProps {
  budgetId: string;
}

export default function DescargasMaestro({ budgetId }: DescargasMaestroProps) {
  const [conPrecios, setConPrecios] = useState(false);
  const qs = conPrecios ? "&precios=1" : "";

  return (
    <>
      <label
        className="flex items-center gap-2 px-2.5 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm text-gray-600 cursor-pointer select-none hover:bg-gray-100"
        title="Tildado, los dos documentos salen con la mano de obra acordada (lo que le pagás al maestro). Destildado, salen en blanco para que él cotice."
      >
        <input
          type="checkbox"
          checked={conPrecios}
          onChange={(e) => setConPrecios(e.target.checked)}
          className="accent-gray-900"
        />
        con precios
      </label>
      <a
        href={`/api/presupuestos/${budgetId}/maestro?format=pdf${qs}`}
        target="_blank"
        className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
        title={
          conPrecios
            ? "PDF con las partidas, cantidades y la mano de obra acordada — para el trato ya cerrado"
            : "PDF con las partidas y cantidades, sin precios — para que el maestro cotice"
        }
      >
        PDF maestro
      </a>
      <a
        href={`/api/presupuestos/${budgetId}/maestro?format=xlsx${qs}`}
        className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
        title={
          conPrecios
            ? "Excel con la mano de obra acordada ya escrita y el total calculado"
            : "Excel editable con fórmulas — el maestro completa P.U. y el TOTAL se calcula solo"
        }
      >
        Excel maestro
      </a>
    </>
  );
}
