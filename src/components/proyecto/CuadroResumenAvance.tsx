"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toPng } from "html-to-image";
import { formatCLP } from "@/lib/utils";
import type { CuadroResumenData, ConceptoKey } from "@/lib/projects/cuadroResumen";

// Cuadro Resumen interactivo: réplica del cuadro Excel de MJ + la fila AVANCE
// editable. Por concepto muestra el acordado vigente, los cobros (agrupados por
// fecha = un avance), TOTAL PAGOS, una fila AVANCE donde MJ pone el % que pide
// EN ESTE avance (incremental) → calcula el monto a pedir, y SALDO PENDIENTE
// recalculado. Es el cuadro que se le entrega al cliente.
//
// Abajo, "Me paso a Sueldos" (INTERNO, no va al cliente): de obra + muebles,
// cuánto generaría el fondo con el avance puesto, menos lo ya transferido.

// Fecha de un movimiento bancario (dd-mm-aa). Va en UTC a propósito: los
// movimientos se guardan a medianoche UTC (el día calendario de la cartola), y
// leídos en hora de Chile (UTC−4) esas 00:00 caen el día ANTERIOR a las 20:00.
// Mismo criterio que la tabla de Banco → Movimientos.
//
// Hasta 2026-08-17 las filas de pagos del cuadro usaban OTRA función que leía
// en local (`getDate()`), así que TODAS las fechas que veía el cliente salían
// corridas un día para atrás: los dos pagos de la factura 178 de Paseo del
// Sena entraron el 07-07 y el cuadro decía 06-07. Esa función se eliminó en
// vez de dejarla al lado — en este archivo TODA fecha es un movimiento
// bancario, así que una segunda versión en hora local solo servía para volver
// a equivocarse.
//
// OJO: las fechas de las VERSIONES (V2, V3) NO pasan por acá. Salen ya
// formateadas de `cuadroResumen.ts`, de `updatedAt`, que es un timestamp real
// con hora y se lee bien en local. Son dos tipos de fecha distintos a
// propósito: no unificar con éste.
function fmtFechaMovimiento(fecha: Date | string): string {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(2);
  return `${dd}-${mm}-${yy}`;
}

// Una transferencia interna Operativa→Sueldos conciliada a esta obra. Es el
// detalle de "Ya transferido": el usuario ve de qué está hecho ese total.
// Una celda de pago ya lista para pintar: el monto de UN concepto, la factura
// con que se cobró y la fecha en que entró. La fecha viaja en la celda (y no en
// la fila) porque cada columna se apila por su cuenta — ver `filasPagos`.
type CeldaPago = { monto: number; folio: string | null; date: Date };

export type TransferenciaSueldo = {
  id: string;
  date: string; // ISO — se serializa en el server component
  amount: number;
  concepto: string | null; // "obra" | "muebles" | null (todavía sin marcar)
};

export default function CuadroResumenAvance({
  data,
  transferencias,
  projectId,
  projectName,
  objetivosGuardados,
  compararGuardado = false,
}: {
  data: CuadroResumenData;
  // Las transferencias a Sueldos de esta obra, de la más nueva a la más vieja.
  // Los totales por concepto se derivan de acá (no llegan calculados aparte):
  // así el detalle desplegable y el "Ya transferido" no pueden divergir.
  transferencias: TransferenciaSueldo[];
  projectId: string;
  // Nombre de la obra — encabezado de la imagen que se le manda al cliente.
  projectName: string;
  // Objetivos % guardados (borrador del avance), o null si nunca se guardó. El
  // JSON comparte lugar con el tilde de comparación (un booleano), por eso el
  // valor puede no ser número — se lee con guard más abajo.
  objetivosGuardados: Record<string, number | boolean> | null;
  // Si esta obra quedó con la fila de comparación prendida la última vez.
  compararGuardado?: boolean;
}) {
  // Totales por concepto — misma suma NETA que antes hacía el groupBy en el
  // server (una devolución viene con monto negativo y netea sola).
  const transferido = useMemo(() => {
    const acc = { obra: 0, muebles: 0, sinConcepto: 0 };
    for (const t of transferencias) {
      if (t.concepto === "obra") acc.obra += t.amount;
      else if (t.concepto === "muebles") acc.muebles += t.amount;
      else acc.sinConcepto += t.amount;
    }
    return acc;
  }, [transferencias]);
  const transferidoTotal = transferido.obra + transferido.muebles + transferido.sinConcepto;
  // El detalle arranca cerrado: el bloque se lee primero como resumen.
  const [verDetalle, setVerDetalle] = useState(false);
  const { conceptos, pagos, totalAcordado, totalPagado, saldoTotal, avanceTotal, versionLabel, anterior } =
    data;

  // % OBJETIVO al que MJ quiere llegar, por concepto. Default por concepto = lo
  // guardado si existe; si no, el % ya cobrado (floor, así "a pedir" arranca en
  // $0). 100% → te pide EXACTO el saldo que falta.
  const [avance, setAvance] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      conceptos.map((c) => {
        const g = objetivosGuardados?.[c.key];
        return [c.key, typeof g === "number" ? g : Math.floor(c.avancePct * 100)];
      })
    )
  );

  // ── Comparación con la versión anterior (opcional) ────────────────────────
  // Fila extra arriba del acordado, en gris, con lo que decía la versión
  // pasada. MJ la prende solo cuando quiere que el cliente vea la variación —
  // por eso es un tilde y no algo siempre visible. Queda guardado por obra.
  const [comparar, setComparar] = useState(compararGuardado);
  // Solo hay algo que comparar si el cálculo encontró una versión anterior
  // enviada/aprobada; si no, el tilde ni se ofrece (no tiene sentido un tilde
  // que no hace nada).
  const hayAnterior = anterior !== null;
  const mostrarAnterior = hayAnterior && comparar;

  // Guardado con retardo (debounce) para no pegarle al server en cada tecla.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function guardar(objetivos: Record<string, number>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/proyectos/${projectId}/avance-objetivos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objetivos }),
      }).catch(() => {});
    }, 600);
  }

  // El tilde se guarda al toque (no hay tecleo que agrupar). El mismo endpoint
  // hace merge parcial, así que esto no le pisa los % del avance.
  function toggleComparar(valor: boolean) {
    setComparar(valor);
    fetch(`/api/proyectos/${projectId}/avance-objetivos`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mostrarVersionAnterior: valor }),
    }).catch(() => {});
  }

  const calc = useMemo(() => {
    const porConcepto = new Map<
      ConceptoKey,
      {
        aPedir: number;
        saldoNuevo: number;
        pctFinal: number;
        generado: number;
        transferido: number;
        faltaTransferir: number;
      }
    >();
    let totalAPedir = 0;
    let totalSaldoNuevo = 0;
    let generadoTotal = 0;
    for (const c of conceptos) {
      // El % es el OBJETIVO al que llegar. A pedir = lo que falta para llegar
      // a ese % (nunca negativo). Así 100% pide exactamente el saldo restante.
      const objetivo = (avance[c.key] ?? 0) / 100;
      const aPedir = Math.max(0, objetivo * c.acordado - c.pagado);
      const saldoNuevo = Math.max(0, c.acordado - c.pagado - aPedir);
      const pctFinal = c.acordado > 0 ? (c.pagado + aPedir) / c.acordado : 0;
      const generado = c.generaSueldo ? Math.min(1, pctFinal) * c.utilidad100 : 0;
      // Transferido por concepto (solo obra/muebles llevan sueldo).
      const transf =
        c.key === "obra" ? transferido.obra : c.key === "muebles" ? transferido.muebles : 0;
      const faltaTransferir = Math.max(0, generado - transf);
      porConcepto.set(c.key, {
        aPedir,
        saldoNuevo,
        pctFinal,
        generado,
        transferido: transf,
        faltaTransferir,
      });
      totalAPedir += aPedir;
      totalSaldoNuevo += saldoNuevo;
      generadoTotal += generado;
    }
    // A transferir total = lo generado menos TODO lo transferido (incl. lo sin
    // clasificar) — es el número real a traspasar.
    const aTransferir = Math.max(0, generadoTotal - transferidoTotal);
    const transferidoDeMas = transferidoTotal - generadoTotal > 1000;
    return { porConcepto, totalAPedir, totalSaldoNuevo, generadoTotal, aTransferir, transferidoDeMas };
  }, [conceptos, avance, transferido, transferidoTotal]);

  // ── Pagos: cada columna de corrido, compactada hacia arriba ──────────────
  //
  // El cálculo (`computeCuadroResumen`) agrupa los pagos por FECHA EXACTA: una
  // fila por día, y si un concepto no se cobró ese día su celda queda con
  // guion. Eso se veía desordenado — en Paseo del Sena la obra tiene pagos el
  // 08-06, 10-06, 29-06 y 06-07, y muebles solo los dos últimos, así que la
  // columna MUEBLES arrancaba dos filas más abajo con dos huecos arriba.
  //
  // Acá reapilamos SOLO PARA MOSTRAR: cada concepto lista sus propios pagos en
  // orden de fecha, sin huecos, y los guiones quedan al final (donde un
  // concepto tiene menos pagos que otro). No se pierde nada: cada concepto ya
  // trae su propia sub-columna FECHA, así que alinear por día no aportaba.
  //
  // Es un cambio de PRESENTACIÓN: los montos son los mismos, así que TOTAL
  // PAGOS, AVANCE y SALDO (que se calculan aparte, sobre `conceptos`) no se
  // mueven. Tampoco toca "Me paso a Sueldos", que comparte el mismo cálculo.
  const filasPagos = useMemo<Partial<Record<ConceptoKey, CeldaPago>>[]>(() => {
    // `pagos` ya viene ordenado por fecha, así que filtrar preserva el orden.
    const columnas = conceptos.map((c) => ({
      key: c.key,
      celdas: pagos
        .filter((r) => r.porConcepto[c.key].monto)
        .map((r) => ({
          monto: r.porConcepto[c.key].monto,
          folio: r.porConcepto[c.key].folio,
          date: r.date,
        })),
    }));
    // Alto de la tabla = el concepto con más pagos.
    const alto = columnas.reduce((max, col) => Math.max(max, col.celdas.length), 0);
    return Array.from({ length: alto }, (_, i) => {
      const fila: Partial<Record<ConceptoKey, CeldaPago>> = {};
      for (const col of columnas) if (col.celdas[i]) fila[col.key] = col.celdas[i];
      return fila;
    });
  }, [conceptos, pagos]);

  // ── Descargar como imagen (versión limpia para el cliente) ───────────────
  // No fotografiamos el formulario (cajitas rojas, inputs). Renderizamos una
  // copia PROLIJA del cuadro fuera de pantalla — con los % como texto plano y
  // la fila AVANCE en una banda clara — y esa copia es la que se exporta a PNG.
  // Estos hooks van ANTES del early return de abajo (regla de hooks de React).
  const exportRef = useRef<HTMLDivElement>(null);
  const [descargando, setDescargando] = useState(false);

  // ── Isotipo de BLARQ para el encabezado de la imagen ─────────────────────
  // El ISOTIPO (la "A"), no el logo completo con el wordmark: es el mismo
  // criterio que en los PDF, donde el wordmark de 31mm va solo en la PORTADA y
  // las hojas con tabla llevan el isotipo a 40px (corrección de MJ del
  // 2026-07-29, ver `.dhead-iso` en ObraPDF/ArtefactosPDF/MueblesPDF). Esta
  // imagen es una hoja de tabla, así que va con isotipo.
  //
  // Los PDF lo incrustan con `assetDataUri()` (lee el archivo con `fs`), pero
  // acá estamos en un componente CLIENTE: no hay `fs`. Se baja por fetch UNA
  // vez y se guarda como data URI en estado.
  //
  // El data URI no es cosmética: html-to-image fotografía el DOM tal cual está
  // en ese instante, y una <img> que todavía no terminó de bajar sale EN
  // BLANCO. Con la imagen ya incrustada no hay red en el momento de la captura
  // (y igual la esperamos con decode() antes de disparar, por las dudas).
  const [isotipoUri, setIsotipoUri] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    fetch("/assets/blarq-isotipo-piedra.png")
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("sin logo"))))
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(new Error("no se pudo leer el logo"));
            fr.readAsDataURL(blob);
          })
      )
      .then((uri) => {
        if (vigente) setIsotipoUri(uri);
      })
      // Si falla, el encabezado cae al texto "BLARQ" de siempre: la imagen
      // sale igual, sin logo, en vez de romperse.
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, []);

  async function descargarImagen() {
    if (!exportRef.current) return;
    setDescargando(true);
    try {
      // Esperar a que TODA imagen del nodo esté decodificada antes de la
      // captura (ver comentario del logo): html-to-image no espera sola.
      await Promise.all(
        Array.from(exportRef.current.querySelectorAll("img")).map((img) =>
          img.decode().catch(() => {})
        )
      );
      const dataUrl = await toPng(exportRef.current, {
        pixelRatio: 2, // nitidez para pantalla retina / impresión
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      const a = document.createElement("a");
      const slug = projectName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      a.href = dataUrl;
      a.download = `cuadro-resumen-${slug || "obra"}.png`;
      a.click();
    } catch {
      // Si algo falla (fuente externa, etc) no rompemos la página.
    } finally {
      setDescargando(false);
    }
  }

  if (conceptos.length === 0 && pagos.length === 0) return null;

  const cellMonto = (v: number) =>
    v > 0 ? <span className="tabular-nums">{formatCLP(v)}</span> : <span className="text-gray-300">—</span>;

  // Igual que cellMonto pero para la fila de la versión anterior: el monto
  // hereda el gris claro de la fila (no lleva color propio) y el "—" va todavía
  // más tenue, porque un concepto que no existía en esa versión no tiene que
  // llamar la atención.
  const cellMontoTenue = (v: number) =>
    v > 0 ? <span className="tabular-nums">{formatCLP(v)}</span> : <span className="text-gray-200">—</span>;

  // ¿Hay algo que pedir en esta celda, o va el guion?
  //
  // Se redondea ANTES de decidir. `aPedir` sale de una resta con fracciones
  // (el objetivo % por el acordado, menos lo pagado), así que un concepto YA
  // cobrado al 100% no da 0 exacto sino una fracción de peso —en Paseo del
  // Sena, 0,26 en Art. Sanitarios y 0,37 en Muebles—. Esa fracción pasaba el
  // `> 0` de antes y la celda terminaba imprimiendo "$0", que es justo lo que
  // la regla de la casa evita ("el cero no ocupa espacio prominente"), y en la
  // imagen que le llega a la clienta.
  //
  // Se compara contra el peso ENTERO que se va a mostrar, que es lo que hace
  // formatCLP: así la condición y lo impreso no pueden discrepar. Va como
  // helper compartido a propósito — lo usan los DOS renders (pantalla y
  // exportación) y si viviera duplicado se volverían a separar (#389).
  const hayQuePedir = (v: number) => Math.round(v) > 0;

  // Total de la fila AVANCE, en pesos ENTEROS — la suma de lo que realmente se
  // muestra en cada celda, no de las fracciones. Con todos los conceptos ya
  // cobrados al 100%, las fracciones sumaban 0,63 y la columna Total imprimía
  // "$1" mientras cada celda decía "—": un total que no cierra con nada de lo
  // que el cliente ve. NO toca el cálculo (`calc.totalAPedir` sigue igual y es
  // el que alimenta el saldo): es solo cómo se imprime esta celda.
  const totalAPedirMostrado = conceptos.reduce(
    (suma, c) => suma + Math.round(calc.porConcepto.get(c.key)!.aPedir),
    0
  );

  function setPct(key: string, value: string) {
    const n = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    setAvance((prev) => {
      const next = { ...prev, [key]: n };
      guardar(next); // persistir el borrador (con retardo)
      return next;
    });
  }

  const sueldoConceptos = conceptos.filter((c) => c.generaSueldo);

  // Fecha de hoy para el pie de la imagen (dd-mm-yyyy). Solo cliente, al pintar.
  const hoy = new Date();
  const hoyStr = `${String(hoy.getDate()).padStart(2, "0")}-${String(
    hoy.getMonth() + 1
  ).padStart(2, "0")}-${hoy.getFullYear()}`;

  return (
    <div className="space-y-4 mb-8">
      {/* ── Cuadro Resumen + AVANCE editable (esto va al cliente) ─────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4 gap-3">
          {/* El rótulo de unidad evita la confusión A1/A9: este cuadro va
              c/IVA (réplica del Excel que va al cliente), mientras las cards
              de arriba están en neto. Sin esta nota, "Total pagos" (c/IVA,
              conciliado) parece contradecir la card "Cobrado" (neto, facturado). */}
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Cuadro Resumen</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">Valores con IVA incluido</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
          {hayAnterior && (
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={comparar}
                onChange={(e) => toggleComparar(e.target.checked)}
                className="accent-gray-900 w-3.5 h-3.5"
              />
              Comparar con {anterior!.versionLabel}
            </label>
          )}
          <button
            type="button"
            onClick={descargarImagen}
            disabled={descargando}
            className="inline-flex items-center gap-1.5 shrink-0 rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
            {descargando ? "Generando…" : "Descargar imagen"}
          </button>
          </div>
        </div>
        {/* Mismo formato que antes (Fecha/Monto/Factura por concepto), pero con
            letra y padding chicos para que entre completo. */}
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border-collapse tabular-nums min-w-[700px]">
            <thead>
              <tr className="uppercase tracking-wide text-gray-600">
                <th className="pb-0.5 pr-1 text-left"></th>
                {conceptos.map((c) => (
                  <th key={c.key} colSpan={3} className="pb-0.5 px-1 text-center border-l border-gray-200 font-semibold">
                    {c.label}
                  </th>
                ))}
                <th className="pb-0.5 pl-1 text-right border-l border-gray-200 font-semibold">Total</th>
              </tr>
              <tr className="uppercase tracking-wide text-gray-400 border-b border-gray-300">
                <th></th>
                {conceptos.map((c) => (
                  <Fragment key={c.key}>
                    <th className="pb-0.5 px-1 border-l border-gray-100 text-left font-medium">Fecha</th>
                    <th className="pb-0.5 px-1 text-right font-medium">Monto</th>
                    <th className="pb-0.5 px-1 text-right font-medium">Fact.</th>
                  </Fragment>
                ))}
                <th className="pb-0.5 pl-1 border-l border-gray-200"></th>
              </tr>
            </thead>
            <tbody>
              {/* Versión ANTERIOR (opcional) — arriba del acordado vigente y en
                  gris claro, para que se lea como el punto de partida y no
                  compita con la fila que manda. */}
              {mostrarAnterior && (
                <tr className="border-b border-gray-100 text-gray-400">
                  <td className="py-1 pr-1 text-left">{anterior!.versionLabel}</td>
                  {conceptos.map((c) => (
                    <Fragment key={c.key}>
                      <td className="py-1 px-1 border-l border-gray-100"></td>
                      <td className="py-1 px-1 text-right whitespace-nowrap">{cellMontoTenue(anterior!.acordado[c.key])}</td>
                      <td className="py-1 px-1"></td>
                    </Fragment>
                  ))}
                  <td className="py-1 pl-1 border-l border-gray-100 text-right whitespace-nowrap tabular-nums">{anterior!.totalComparable ? formatCLP(anterior!.total) : <span className="text-gray-200">—</span>}</td>
                </tr>
              )}

              {/* Acordado (versión vigente) */}
              <tr className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-900">
                <td className="py-1 pr-1 text-left">{versionLabel}</td>
                {conceptos.map((c) => (
                  <Fragment key={c.key}>
                    <td className="py-1 px-1 border-l border-gray-200 text-left text-gray-500 font-normal whitespace-nowrap">{c.fecha}</td>
                    <td className="py-1 px-1 text-right whitespace-nowrap">{cellMonto(c.acordado)}</td>
                    <td className="py-1 px-1"></td>
                  </Fragment>
                ))}
                <td className="py-1 pl-1 border-l border-gray-200 text-right whitespace-nowrap">{formatCLP(totalAcordado)}</td>
              </tr>

              {/* Cobros — cada columna de corrido (ver `filasPagos`) */}
              {filasPagos.map((fila, i) => (
                <tr key={i} className="border-b border-gray-50 text-gray-700">
                  <td className="py-1 pr-1"></td>
                  {conceptos.map((c) => {
                    const cell = fila[c.key];
                    return (
                      <Fragment key={c.key}>
                        <td className="py-1 px-1 border-l border-gray-100 text-left text-gray-500 whitespace-nowrap">{cell ? fmtFechaMovimiento(cell.date) : ""}</td>
                        <td className="py-1 px-1 text-right whitespace-nowrap">{cellMonto(cell?.monto ?? 0)}</td>
                        <td className="py-1 px-1 text-right text-gray-500">{cell?.folio ?? ""}</td>
                      </Fragment>
                    );
                  })}
                  <td className="py-1 pl-1 border-l border-gray-200"></td>
                </tr>
              ))}

              {/* Aire entre el detalle de transferencias y el bloque de
                  totales de abajo (pedido de MJ): una fila vacía que da
                  espacio en blanco para separar visualmente el detalle de
                  los subtotales (Total pagos / Avance / Saldo pendiente). */}
              <tr aria-hidden="true">
                <td colSpan={2 + conceptos.length * 3} className="h-4"></td>
              </tr>

              {/* TOTAL PAGOS — sin fondo propio (ver el mismo bloque en el
                  render de exportación, más abajo: la banda clara del AVANCE
                  quedaba pegada a este gris y las dos se confundían). Se toca
                  acá TAMBIÉN, aunque en pantalla el AVANCE sea rojo y no haya
                  banda clara, para que la pantalla y la imagen no se separen —
                  es el error que ya mordió en el #389. */}
              <tr className="border-t border-gray-300 font-semibold text-gray-600">
                <td className="py-1 pr-1 text-left uppercase tracking-wide">Total pagos</td>
                {conceptos.map((c) => (
                  <Fragment key={c.key}>
                    <td className="py-1 px-1 border-l border-gray-200 text-left text-gray-500 font-normal">{(c.avancePct * 100).toFixed(0)}%</td>
                    <td colSpan={2} className="py-1 px-1 text-right whitespace-nowrap">{cellMonto(c.pagado)}</td>
                  </Fragment>
                ))}
                <td className="py-1 pl-1 border-l border-gray-200 text-right whitespace-nowrap">{formatCLP(totalPagado)}</td>
              </tr>

              {/* AVANCE editable */}
              <tr className="text-rose-700 font-medium bg-rose-50/40">
                <td className="py-1 pr-1 text-left uppercase tracking-wide">Avance (a cobrar)</td>
                {conceptos.map((c) => {
                  const cc = calc.porConcepto.get(c.key)!;
                  return (
                    <Fragment key={c.key}>
                      <td className="py-1 px-1 border-l border-gray-200 text-left">
                        <span className="inline-flex items-center gap-0.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={avance[c.key] ?? 0}
                            onChange={(e) => setPct(c.key, e.target.value)}
                            className="w-9 text-right tabular-nums border border-rose-300 rounded px-0.5 py-0.5 text-[10px] focus:ring-1 focus:ring-rose-500 focus:border-rose-500 outline-none"
                          />
                          <span>%</span>
                        </span>
                      </td>
                      <td colSpan={2} className="py-1 px-1 text-right whitespace-nowrap">
                        {hayQuePedir(cc.aPedir) ? formatCLP(cc.aPedir) : <span className="text-rose-300">—</span>}
                      </td>
                    </Fragment>
                  );
                })}
                <td className="py-1 pl-1 border-l border-gray-200 text-right whitespace-nowrap">{formatCLP(totalAPedirMostrado)}</td>
              </tr>

              {/* SALDO PENDIENTE */}
              <tr className="border-t border-gray-200 text-gray-900 font-medium">
                <td className="py-1 pr-1 text-left uppercase tracking-wide">Saldo pendiente</td>
                {conceptos.map((c) => {
                  const cc = calc.porConcepto.get(c.key)!;
                  return (
                    <td key={c.key} colSpan={3} className="py-1 px-1 border-l border-gray-200 text-right whitespace-nowrap">{cellMonto(cc.saldoNuevo)}</td>
                  );
                })}
                <td className="py-1 pl-1 border-l border-gray-200 text-right whitespace-nowrap">{formatCLP(calc.totalSaldoNuevo)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Avance total cobrado: {(avanceTotal * 100).toFixed(0)}% del acordado.
          {calc.totalAPedir > 0 && (
            <> Con este avance pedís <span className="text-rose-700 font-medium tabular-nums">{formatCLP(calc.totalAPedir)}</span> y el saldo queda en {formatCLP(calc.totalSaldoNuevo)}.</>
          )}
        </p>
      </div>

      {/* ── Me paso a Sueldos (INTERNO) ──────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Me paso a Sueldos</h2>
          <span className="text-xs text-gray-400">interno · no va al cliente · solo obra + muebles</span>
        </div>
        <table className="w-full text-sm mt-3">
          <thead className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <tr>
              <th className="text-left pb-2">Concepto</th>
              <th className="text-right pb-2">Utilidad al 100%</th>
              <th className="text-right pb-2 w-16">% avance</th>
              <th className="text-right pb-2">Generado</th>
              <th className="text-right pb-2">Ya transferido</th>
              <th className="text-right pb-2">Falta transferir</th>
            </tr>
          </thead>
          <tbody>
            {sueldoConceptos.map((c) => {
              const cc = calc.porConcepto.get(c.key)!;
              return (
                <tr key={c.key} className="border-b border-gray-50">
                  <td className="py-2 text-gray-900">
                    {c.label}
                    {c.key === "obra" && <span className="text-[11px] text-gray-400 ml-1">· GG</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{formatCLP(c.utilidad100)}</td>
                  <td className="py-2 text-right tabular-nums text-gray-400">{(cc.pctFinal * 100).toFixed(0)}%</td>
                  <td className="py-2 text-right tabular-nums font-medium text-emerald-800">{formatCLP(cc.generado)}</td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{formatCLP(cc.transferido)}</td>
                  <td className="py-2 text-right tabular-nums font-medium text-gray-900">{formatCLP(cc.faltaTransferir)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-gray-200 font-bold">
              <td className="py-2 uppercase tracking-wider text-xs text-gray-700" colSpan={3}>Total</td>
              <td className="py-2 text-right tabular-nums text-gray-900">{formatCLP(calc.generadoTotal)}</td>
              <td className="py-2 text-right tabular-nums text-gray-700">{formatCLP(transferidoTotal)}</td>
              <td className="py-2 text-right tabular-nums text-gray-900">{formatCLP(calc.aTransferir)}</td>
            </tr>
          </tbody>
        </table>
        {/* ── Detalle: de qué transferencias está hecho el "Ya transferido" ──
            Una sola lista en orden de fecha (de la más nueva a la más vieja),
            con el concepto de cada una. Antes solo se veía el total y no había
            forma de saber qué traspasos lo componían. Arranca cerrado. */}
        {transferencias.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setVerDetalle((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <span className="text-[9px] text-gray-500">{verDetalle ? "▾" : "▸"}</span>
              {verDetalle ? "Ocultar" : "Ver"} {transferencias.length}{" "}
              {transferencias.length === 1 ? "transferencia" : "transferencias"}
            </button>

            {verDetalle && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <table className="w-full text-xs">
                  <thead className="text-[9px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                    <tr>
                      <th className="text-left pb-1.5 w-24">Fecha</th>
                      <th className="text-left pb-1.5">Concepto</th>
                      <th className="text-right pb-1.5">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transferencias.map((t) => {
                      const sinMarcar = t.concepto !== "obra" && t.concepto !== "muebles";
                      return (
                        <tr key={t.id} className="border-b border-gray-200 last:border-0">
                          <td className="py-1.5 text-gray-600 tabular-nums">
                            {fmtFechaMovimiento(t.date)}
                          </td>
                          <td className="py-1.5">
                            {sinMarcar ? (
                              <span className="inline-block rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] uppercase tracking-wide text-amber-700">
                                Sin marcar
                              </span>
                            ) : (
                              <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[9px] uppercase tracking-wide text-gray-600">
                                {t.concepto === "obra" ? "Obra" : "Muebles"}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-gray-900">
                            {formatCLP(t.amount)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-gray-300 font-bold text-gray-900">
                      <td className="pt-2 uppercase tracking-wider text-[10px]" colSpan={2}>
                        Total transferido
                      </td>
                      <td className="pt-2 text-right tabular-nums">{formatCLP(transferidoTotal)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[11px] text-gray-500 mt-2 tabular-nums">
                  Obra {formatCLP(transferido.obra)} · Muebles {formatCLP(transferido.muebles)}
                  {transferido.sinConcepto !== 0 && (
                    <> · Sin marcar {formatCLP(transferido.sinConcepto)}</>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mt-4">
          <Metric label="Generado" value={calc.generadoTotal} />
          <Metric label="Ya transferido" value={transferidoTotal} />
          <Metric label="A transferir ahora" value={calc.aTransferir} tone="ok" />
        </div>
        {transferido.sinConcepto > 1000 && (
          <p className="text-[11px] text-amber-700 mt-2">
            Hay {formatCLP(transferido.sinConcepto)} transferido sin marcar obra/muebles — son las
            filas ámbar del detalle. El concepto se marca en Banco.
          </p>
        )}
        {/* Puente al banco: estás en la obra y querés ir a revisar los traspasos
            o marcarles el concepto. Abre Banco → Movimientos ya filtrado por
            esta obra (el filtro de obra de la columna Respaldo). */}
        {transferencias.length > 0 && (
          <p className="text-[11px] text-gray-500 mt-2">
            <Link
              href={`/banco/movimientos?respaldo=interna&proyecto=${projectId}`}
              className="underline hover:text-gray-900"
            >
              Ver estos traspasos en Banco
            </Link>
          </p>
        )}
        {calc.transferidoDeMas && (
          <p className="text-[11px] text-amber-700 mt-2">
            Ya te transferiste más de lo generado ({formatCLP(transferidoTotal)} vs {formatCLP(calc.generadoTotal)}).
            Te adelantaste {formatCLP(transferidoTotal - calc.generadoTotal)}.
          </p>
        )}
      </div>

      {/* ── Versión PROLIJA para exportar a imagen (fuera de pantalla) ──────
          Es lo que se le manda al cliente: los % van como TEXTO PLANO (no
          cajitas editables), la fila AVANCE en una banda clara editorial, sin
          inputs ni cursores. No mostramos "Me paso a Sueldos" (es interno).
          Se renderiza siempre pero posicionado fuera de la vista; el botón
          captura este nodo con html-to-image. */}
      <div
        aria-hidden
        style={{ position: "fixed", left: "-10000px", top: 0, pointerEvents: "none" }}
      >
        <div ref={exportRef} data-export-cuadro className="bg-white p-8 inline-block" style={{ fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)" }}>
          {/* Encabezado */}
          <div className="flex items-end justify-between mb-5 gap-8">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 mb-1">Cuadro Resumen</p>
              <h1 className="text-2xl font-semibold text-gray-900 leading-tight">{projectName}</h1>
            </div>
            {/* Marca: el isotipo, con las mismas medidas que en las hojas de
                tabla de los PDF (40px, opacidad .55) — discreto, porque esto
                es un cuadro de números y no una portada. Si no cargó, cae al
                texto "BLARQ" de antes. */}
            <div className="text-right text-[11px] text-gray-400 leading-snug">
              {isotipoUri ? (
                <img
                  src={isotipoUri}
                  alt="BLARQ"
                  style={{ width: "40px", height: "auto", opacity: 0.55 }}
                  className="inline-block mb-2"
                />
              ) : (
                <p className="font-medium text-gray-600">BLARQ</p>
              )}
              <p>{hoyStr}</p>
            </div>
          </div>

          <table className="text-xs border-collapse tabular-nums" style={{ minWidth: "760px" }}>
            <thead>
              <tr className="text-gray-600">
                <th className="pb-1 pr-2 text-left"></th>
                {conceptos.map((c) => (
                  <th key={c.key} colSpan={3} className="pb-1 px-2 text-center border-l border-gray-200 font-semibold uppercase tracking-wide text-[10px]">
                    {c.label}
                  </th>
                ))}
                <th className="pb-1 pl-2 text-right border-l border-gray-200 font-semibold uppercase tracking-wide text-[10px]">Total</th>
              </tr>
              <tr className="text-gray-400 border-b border-gray-300 text-[9px] uppercase tracking-wide">
                <th></th>
                {conceptos.map((c) => (
                  <Fragment key={c.key}>
                    <th className="pb-1 px-2 border-l border-gray-100 text-left font-medium">Fecha</th>
                    <th className="pb-1 px-2 text-right font-medium">Monto</th>
                    {/* "Factura" completo (y no "Fact.") porque esta imagen la
                        lee el cliente, no MJ: la abreviatura no se entiende de
                        afuera. Va en nowrap para que no se parta en dos. */}
                    <th className="pb-1 px-2 text-right font-medium whitespace-nowrap">Factura</th>
                  </Fragment>
                ))}
                <th className="pb-1 pl-2 border-l border-gray-200"></th>
              </tr>
            </thead>
            <tbody>
              {/* Versión ANTERIOR (opcional) — misma fila que en pantalla: es
                  la comparación que MJ le manda al cliente, así que tiene que
                  salir igual en la imagen. */}
              {mostrarAnterior && (
                <tr className="border-b border-gray-100 text-gray-400">
                  <td className="py-1.5 pr-2 text-left">{anterior!.versionLabel}</td>
                  {conceptos.map((c) => (
                    <Fragment key={c.key}>
                      <td className="py-1.5 px-2 border-l border-gray-100"></td>
                      <td className="py-1.5 px-2 text-right whitespace-nowrap">{cellMontoTenue(anterior!.acordado[c.key])}</td>
                      <td className="py-1.5 px-2"></td>
                    </Fragment>
                  ))}
                  <td className="py-1.5 pl-2 border-l border-gray-100 text-right whitespace-nowrap tabular-nums">{anterior!.totalComparable ? formatCLP(anterior!.total) : <span className="text-gray-200">—</span>}</td>
                </tr>
              )}

              {/* Acordado */}
              <tr className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-900">
                <td className="py-1.5 pr-2 text-left">{versionLabel}</td>
                {conceptos.map((c) => (
                  <Fragment key={c.key}>
                    <td className="py-1.5 px-2 border-l border-gray-200 text-left text-gray-500 font-normal whitespace-nowrap">{c.fecha}</td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">{cellMonto(c.acordado)}</td>
                    <td className="py-1.5 px-2"></td>
                  </Fragment>
                ))}
                <td className="py-1.5 pl-2 border-l border-gray-200 text-right whitespace-nowrap">{formatCLP(totalAcordado)}</td>
              </tr>

              {/* Cobros — mismo apilado por columna que en pantalla.
                  El bloque va rotulado "Transferencias" en la columna de la
                  izquierda (la misma donde viven TOTAL PAGOS / SALDO
                  PENDIENTE), sobre la primera fila: sin rótulo, el cliente ve
                  una lista de montos y no entiende que son SUS pagos. */}
              {filasPagos.map((fila, i) => (
                <tr key={i} className="border-b border-gray-50 text-gray-700">
                  <td className="py-1.5 pr-2 text-left uppercase tracking-wide text-[10px] text-gray-500 align-top whitespace-nowrap">
                    {i === 0 ? "Transferencias" : ""}
                  </td>
                  {conceptos.map((c) => {
                    const cell = fila[c.key];
                    return (
                      <Fragment key={c.key}>
                        <td className="py-1.5 px-2 border-l border-gray-100 text-left text-gray-500 whitespace-nowrap">{cell ? fmtFechaMovimiento(cell.date) : ""}</td>
                        <td className="py-1.5 px-2 text-right whitespace-nowrap">{cellMonto(cell?.monto ?? 0)}</td>
                        <td className="py-1.5 px-2 text-right text-gray-500">{cell?.folio ?? ""}</td>
                      </Fragment>
                    );
                  })}
                  <td className="py-1.5 pl-2 border-l border-gray-200"></td>
                </tr>
              ))}

              {/* Aire entre el detalle de transferencias y el bloque de
                  totales — igual que en pantalla: una fila vacía que separa
                  los pagos de los subtotales (Total pagos / Avance / Saldo). */}
              <tr aria-hidden="true">
                <td colSpan={2 + conceptos.length * 3} className="h-5"></td>
              </tr>

              {/* TOTAL PAGOS — sin fondo propio a propósito. Antes iba en
                  `bg-gray-50` (#F5F5F5) y quedaba casi igual a la banda del
                  AVANCE de abajo; con dos grises apilados la banda dejaba de
                  distinguirse. Esta fila cede el peso y se queda con el filete:
                  la que manda es la de abajo. (Con el AVANCE ya en greige el
                  choque no volvería, pero la jerarquía sigue siendo la buena:
                  una sola fila con fondo, y es la que hay que cobrar.) */}
              <tr className="border-t border-gray-300 font-semibold text-gray-600">
                <td className="py-1.5 pr-2 text-left uppercase tracking-wide text-[10px]">Total pagos</td>
                {conceptos.map((c) => (
                  <Fragment key={c.key}>
                    <td className="py-1.5 px-2 border-l border-gray-200 text-left text-gray-500 font-normal">{(c.avancePct * 100).toFixed(0)}%</td>
                    <td colSpan={2} className="py-1.5 px-2 text-right whitespace-nowrap">{cellMonto(c.pagado)}</td>
                  </Fragment>
                ))}
                <td className="py-1.5 pl-2 border-l border-gray-200 text-right whitespace-nowrap">{formatCLP(totalPagado)}</td>
              </tr>

              {/* AVANCE (a cobrar) — banda de un greige apagado, % como texto plano.
                  Tres pasadas hasta llegar acá, y las tres las decidió MJ mirando
                  el cuadro renderizado con datos reales (§4.10):

                  1. Hasta 2026-08-17 iba en `bg-gray-900` (#2A2722) con texto
                     blanco. MJ, mirando Casa Los Algarrobos: "me parece muy
                     fuerte el negro" — en un documento que ve el cliente, un
                     bloque casi negro cruzando el cuadro pesa de más. Se invirtió
                     a fondo Banda (#EDEDEC) con letra oscura.
                  2. La Banda tampoco servía, pero por lo contrario: #EDEDEC es
                     EXACTAMENTE el mismo tono que el encabezado de esta tabla
                     — el `thead` no pinta color propio, así que hereda la regla
                     global `table thead th { background: var(--color-banda) }`
                     de globals.css. La fila que tiene que destacarse competía
                     con el encabezado. Se bajó a Greige (#C2BCB4).
                  3. Greige destacaba bien pero MJ: "algo más gris que tan café".
                     Y tenía razón: los neutros del Manual v2 están recoloreados
                     al matiz cálido del isotipo a propósito, y sostenido sobre
                     un área grande ese calor se lee marrón.

                  DE DÓNDE SALE #BFBCB8: es el greige con la mitad del color —
                  misma luminosidad exacta, la distancia entre canales cortada al
                  medio (194/188/180, 14 puntos → 191/188/184, 7 puntos). Se
                  eligió sobre un gris 100% neutro (#BDBDBD, que también se le
                  mostró) para que la fila siga perteneciendo a la familia tibia:
                  el texto y los bordes de alrededor SÍ son cálidos, y un neutro
                  puro se lee de otra temperatura.

                  NO es un tono del Manual de Marca y no se agregó a la paleta a
                  propósito: es un derivado para esta fila, se usa acá y en ningún
                  otro lado. Si algún día hay que reusarlo, ahí sí conviene
                  bautizarlo en globals.css — antes no.

                  El peso lo hace la TIPOGRAFÍA (semibold + el total en bold)
                  reforzada por el fondo, no el color de la letra — §3 CLAUDE.md.

                  Contraste sobre #BFBCB8 — medido sobre el DOM real, no a ojo
                  (scripts/diag-cuadro-banda-variantes.ts lo imprime), porque esto
                  se lee en pantalla Y en papel. El rótulo y los montos en gray-800
                  quedan en 6.5:1, de sobra. Los otros tres tonos de la fila SÍ
                  hubo que subirlos un peldaño al oscurecer el fondo, porque un
                  fondo más oscuro se le acerca a TODO lo que vive adentro, no
                  solo al texto principal:
                    · el % pasó de gray-600 a gray-700 — en gray-600 caía a
                      3.4:1, bajo el mínimo AA de 4.5; ahora da 5.0:1;
                    · el guión de "nada que cobrar" de gray-400 a gray-500, para
                      conservar los ~2.1:1 que tenía sobre la banda vieja
                      (discreto a propósito — §3, "el cero no ocupa espacio
                      prominente" — pero no borrado);
                    · los filetes verticales de gray-300 a gray-400, porque
                      gray-300 (#CFCBC5) es más CLARO que este fondo y se perdía
                      adentro de la fila (1.17:1). Con gray-400 quedan en
                      1.36:1, el mismo peso que tenían antes.

                  El `data-banda-avance` es un enganche para los scripts de
                  verificación: sin él la fila solo se puede agarrar por su color,
                  que es justo lo que cambia en cada tanda de pruebas. */}
              <tr data-banda-avance className="bg-[#BFBCB8] text-gray-800 font-semibold border-y border-gray-400">
                <td className="py-2 pr-2 pl-1 text-left uppercase tracking-wide text-[10px]">Avance a cobrar</td>
                {conceptos.map((c) => {
                  const cc = calc.porConcepto.get(c.key)!;
                  return (
                    <Fragment key={c.key}>
                      <td className="py-2 px-2 border-l border-gray-400 text-left text-gray-700 font-normal">{avance[c.key] ?? 0}%</td>
                      <td colSpan={2} className="py-2 px-2 text-right whitespace-nowrap">
                        {hayQuePedir(cc.aPedir) ? formatCLP(cc.aPedir) : <span className="text-gray-500">—</span>}
                      </td>
                    </Fragment>
                  );
                })}
                <td className="py-2 pl-2 pr-1 border-l border-gray-400 text-right whitespace-nowrap font-bold">{formatCLP(totalAPedirMostrado)}</td>
              </tr>

              {/* SALDO PENDIENTE */}
              <tr className="border-t border-gray-200 text-gray-900 font-medium">
                <td className="py-1.5 pr-2 text-left uppercase tracking-wide text-[10px]">Saldo pendiente</td>
                {conceptos.map((c) => {
                  const cc = calc.porConcepto.get(c.key)!;
                  return (
                    <td key={c.key} colSpan={3} className="py-1.5 px-2 border-l border-gray-200 text-right whitespace-nowrap">{cellMonto(cc.saldoNuevo)}</td>
                  );
                })}
                <td className="py-1.5 pl-2 border-l border-gray-200 text-right whitespace-nowrap">{formatCLP(calc.totalSaldoNuevo)}</td>
              </tr>
            </tbody>
          </table>
          {/* Sin nota al pie: el resumen en palabras ("avance total cobrado…")
              es para MJ y quedó SOLO en la vista de pantalla. En la imagen que
              va al cliente los números del cuadro se explican solos. */}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "ok" }) {
  return (
    <div className={`rounded-lg p-3 ${tone === "ok" ? "bg-emerald-50" : "bg-gray-50"}`}>
      <p className={`text-[10px] uppercase tracking-wider ${tone === "ok" ? "text-emerald-700" : "text-gray-500"}`}>{label}</p>
      <p className={`text-lg font-semibold tabular-nums mt-0.5 ${tone === "ok" ? "text-emerald-800" : "text-gray-900"}`}>{formatCLP(value)}</p>
    </div>
  );
}
