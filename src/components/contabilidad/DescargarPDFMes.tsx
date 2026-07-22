"use client";

import { useState } from "react";

// Botón "Respaldo del mes" de Contabilidad → Gastos. Abre el PDF mensual en
// una pestaña nueva. Se puede pedir con las fotos de los respaldos (el archivo
// que sirve de verdad para el F22) o sin ellas (copia liviana para mirar o
// mandar por mail).
export default function DescargarPDFMes({
  mes,
  deshabilitado,
}: {
  mes: string; // YYYY-MM
  deshabilitado?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  function abrir(conFotos: boolean) {
    setAbierto(false);
    const url = `/api/contabilidad/gastos/pdf?mes=${mes}${conFotos ? "" : "&fotos=0"}`;
    window.open(url, "_blank");
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={deshabilitado}
        onClick={() => setAbierto((v) => !v)}
        className="px-3 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        title={
          deshabilitado
            ? "No hay gastos en este mes"
            : "Respaldo mensual en PDF"
        }
      >
        Respaldo del mes
      </button>
      {abierto && !deshabilitado && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setAbierto(false)}
          />
          <div className="absolute right-0 mt-1 z-20 w-60 bg-white border border-gray-200 rounded-xl shadow-sm py-1">
            <Opcion
              titulo="Con las fotos"
              detalle="La planilla y la foto de cada boleta. Es el respaldo completo."
              onClick={() => abrir(true)}
            />
            <Opcion
              titulo="Solo la planilla"
              detalle="Sin fotos: archivo liviano para mirar o mandar."
              onClick={() => abrir(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Opcion({
  titulo,
  detalle,
  onClick,
}: {
  titulo: string;
  detalle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-gray-50"
    >
      <span className="block text-sm text-gray-900">{titulo}</span>
      <span className="block text-xs text-gray-500 leading-snug mt-0.5">
        {detalle}
      </span>
    </button>
  );
}
