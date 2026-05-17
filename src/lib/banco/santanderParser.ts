// Parser de cartolas Santander Chile — soporta los 2 formatos que exporta
// el banco: "Provisoria" (mes en curso) y "Histórica" (mes cerrado).
//
// Diferencias entre formatos:
//   - Provisoria: header de columnas en fila 12 (0-idx), datos desde 13.
//   - Histórica: header en fila 15, con bloque "Línea de Crédito" en medio.
//
// Detección: leemos hasta encontrar la fila con "MONTO" en col 0 y "FECHA"
// en col 3 — esa es el header, y los datos vienen abajo hasta una fila vacía
// o el bloque "Resumen comisiones" / "Saldos diarios".

import * as XLSX from "xlsx";

export interface ParsedMovement {
  date: Date;
  description: string;
  amount: number; // signed: negativo = cargo, positivo = abono
  type: "cargo" | "abono";
  // Saldo corrido tras aplicar este movimiento, calculado sobre un orden
  // canónico (fecha, monto, descripción) — ver el bloque de cálculo abajo.
  // Es el identificador estable para deduplicar el import: no depende del
  // formato de cartola, a diferencia de externalRef.
  balanceAfter: number;
  externalRef: string | null;
  counterpartyName: string | null;
  counterpartyRut: string | null;
  // Categoría sugerida según patrones de descripción.
  // null si no se reconoce nada — ahí MJ asigna en la UI.
  suggestedCategory: string | null;
  // Indica si la descripción identifica una transferencia interna BLARQ→BLARQ
  // (RUT 077270733-9). El matching final entre los dos lados se hace después.
  isInternalCandidate: boolean;
}

export interface ParsedCartola {
  // Número de cuenta tal como aparece en la cartola (ej: "0-000-8913459-5")
  accountNumber: string;
  cartolaNumber: string;
  fechaDesde: Date | null;
  fechaHasta: Date | null;
  saldoInicial: number;
  saldoFinal: number;
  movements: ParsedMovement[];
}

// RUT de BLARQ. Movimientos con este RUT en la descripción son transferencias
// internas entre cuenta operativa y cuenta sueldos (deben no contarse como
// gasto/ingreso real).
const BLARQ_RUT_DIGITS = "0772707339"; // 077270733-9 sin guión y con prefijo banco

export function parseCartolaSantander(buffer: Buffer): ParsedCartola {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  // ── Metadata: cuenta + período ─────────────────────────────────────
  let accountNumber = "";
  let cartolaNumber = "";
  let fechaDesde: Date | null = null;
  let fechaHasta: Date | null = null;
  let saldoInicial = 0;
  let saldoFinal = 0;

  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      // "Cuenta 0-000-8913459-5" o "Cuenta Corriente N°: 0-000-8913459-5"
      const accMatch = cell.match(/(\d-\d{3}-\d{7}-[\dK])/);
      if (accMatch && !accountNumber) accountNumber = accMatch[1];
      const cartolaMatch = cell.match(/Número cartola:\s*(\d+)/);
      if (cartolaMatch) cartolaNumber = cartolaMatch[1];
      const fdMatch = cell.match(/Fecha desde:\s*(\d{2})\/(\d{2})\/(\d{4})/);
      if (fdMatch) fechaDesde = new Date(`${fdMatch[3]}-${fdMatch[2]}-${fdMatch[1]}`);
      const fhMatch = cell.match(/Fecha hasta:\s*(\d{2})\/(\d{2})\/(\d{4})/);
      if (fhMatch) fechaHasta = new Date(`${fhMatch[3]}-${fhMatch[2]}-${fhMatch[1]}`);
    }
  }

  // ── Header de columnas + saldo inicial/final ────────────────────────
  // Detección flexible: el banco tiene varios formatos (Cartola, Movimientos
  // CtaCte, Histórica, Provisoria) y el orden de columnas cambia. Buscamos
  // la fila que tenga MONTO + DESCRIPCIÓN + FECHA + CARGO/ABONO en cualquier
  // posición, y guardamos el índice de cada columna.
  let headerRow = -1;
  const cols = {
    monto: -1,
    descripcion: -1,
    fecha: -1,
    saldo: -1,
    documento: -1,
    cargoAbono: -1,
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const c = { monto: -1, descripcion: -1, fecha: -1, saldo: -1, documento: -1, cargoAbono: -1 };
    for (let j = 0; j < row.length; j++) {
      const cell = row[j];
      if (typeof cell !== "string") continue;
      const upper = cell.toUpperCase();
      if (upper === "MONTO" || upper.startsWith("MONTO ")) c.monto = j;
      else if (upper.includes("DESCRIPC")) c.descripcion = j;
      else if (upper === "FECHA" || upper.startsWith("FECHA ")) c.fecha = j;
      else if (upper === "SALDO" || upper.startsWith("SALDO ")) c.saldo = j;
      else if (upper.includes("DOCUMENTO") || upper === "N° DOCUMENTO" || upper === "Nº DOCUMENTO") c.documento = j;
      else if (upper.includes("CARGO") && upper.includes("ABONO")) c.cargoAbono = j;
    }
    if (c.monto >= 0 && c.descripcion >= 0 && c.fecha >= 0) {
      headerRow = i;
      cols.monto = c.monto;
      cols.descripcion = c.descripcion;
      cols.fecha = c.fecha;
      cols.saldo = c.saldo;
      cols.documento = c.documento;
      cols.cargoAbono = c.cargoAbono;
      break;
    }
  }
  if (headerRow === -1) {
    throw new Error("No se encontró el header de columnas en la cartola");
  }

  // Saldo inicial / final: la fila inmediata después de "SALDO INICIAL".
  // foundSaldos distingue "no se encontró el bloque" de "los saldos son 0":
  // sin él no podríamos verificar el saldo acumulado más abajo.
  let foundSaldos = false;
  for (let i = 0; i < headerRow; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row[0] === "SALDO INICIAL") {
      const valuesRow = rows[i + 1];
      if (valuesRow) {
        saldoInicial = typeof valuesRow[0] === "number" ? valuesRow[0] : 0;
        // Saldo final está en la última columna numérica de esa fila.
        // Provisoria: col 3. Histórica: col 6.
        for (let j = valuesRow.length - 1; j >= 0; j--) {
          if (typeof valuesRow[j] === "number") {
            saldoFinal = valuesRow[j] as number;
            break;
          }
        }
        foundSaldos = true;
      }
      break;
    }
  }

  // ── Movimientos: desde headerRow+1 hasta una fila vacía o "Resumen" ──
  // El saldo posterior (balanceAfter) se calcula DESPUÉS de leer todo,
  // sobre un orden canónico — ver el bloque más abajo.
  const movements: ParsedMovement[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    // Filas que cortan: "Resumen comisiones", "Saldos diarios", o todo null
    const firstCell = row[0];
    if (typeof firstCell === "string") {
      if (
        firstCell.includes("Resumen comisiones") ||
        firstCell.includes("Saldos diarios") ||
        firstCell === "MONTO" || // segundo header
        firstCell === "SALDO"
      ) {
        break;
      }
      // Filas de comisiones, fechas sueltas — saltar
      continue;
    }
    if (firstCell === null) continue;

    // Línea de movimiento — leemos según el mapa de columnas detectado
    // arriba (cols.monto, cols.fecha, etc) en lugar de índices hardcoded.
    const amountCell = row[cols.monto];
    const amount = typeof amountCell === "number" ? amountCell : 0;
    const description = String(row[cols.descripcion] ?? "").trim();
    if (!description) continue;
    const docRef = cols.documento >= 0 ? row[cols.documento] : null;
    const dateRaw: unknown = row[cols.fecha];
    let date: Date | null = null;
    if (typeof dateRaw === "string") {
      const m = dateRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) date = new Date(`${m[3]}-${m[2]}-${m[1]}`);
    } else if (dateRaw instanceof Date) {
      date = dateRaw;
    } else if (typeof dateRaw === "number") {
      // Excel serial date
      const d = XLSX.SSF.parse_date_code(dateRaw);
      if (d) date = new Date(Date.UTC(d.y, d.m - 1, d.d));
    }
    if (!date) continue;

    const tipoLetter = cols.cargoAbono >= 0
      ? String(row[cols.cargoAbono] ?? "").trim().toUpperCase()
      : "";
    const type: "cargo" | "abono" =
      tipoLetter === "C" ? "cargo" : tipoLetter === "A" ? "abono" : amount < 0 ? "cargo" : "abono";

    const parsed = parseDescription(description);
    const suggestedCategory = inferCategory(description);
    const isInternalCandidate = parsed.counterpartyRut?.startsWith(BLARQ_RUT_DIGITS) ?? false;

    movements.push({
      date,
      description,
      amount,
      type,
      balanceAfter: 0, // se calcula abajo, sobre el orden canónico
      externalRef: typeof docRef === "number" && docRef > 0 ? String(docRef) : null,
      counterpartyName: parsed.counterpartyName,
      counterpartyRut: parsed.counterpartyRut,
      suggestedCategory,
      isInternalCandidate,
    });
  }

  // ── Saldo posterior (balanceAfter) sobre un orden CANÓNICO ──────────
  // El banco lista los movimientos de un mismo día en distinto orden según
  // el formato de cartola (Histórica vs Provisoria). Si calculáramos el
  // saldo corrido en el orden en que vienen las filas, el mismo movimiento
  // tendría balanceAfter distinto en cada formato y la deduplicación del
  // import fallaría. Por eso ordenamos por (fecha, monto, descripción) —
  // un orden determinístico e idéntico entre formatos — antes de acumular.
  // El conjunto de movimientos de un día sí es idéntico entre formatos;
  // solo cambia el orden, así que este orden canónico estabiliza la llave.
  // balanceAfter no es entonces el saldo intradía real del banco, pero el
  // saldo de cierre de cada día y del total sí lo es (la suma no depende
  // del orden) — y como llave de deduplicación es lo que necesitamos.
  movements.sort((a, b) => {
    const da = a.date.getTime() - b.date.getTime();
    if (da !== 0) return da;
    if (a.amount !== b.amount) return a.amount - b.amount;
    return a.description.localeCompare(b.description);
  });
  let running = saldoInicial;
  for (const m of movements) {
    running += m.amount;
    m.balanceAfter = running;
  }

  // Verificación de integridad: el saldo corrido final tiene que coincidir
  // con el saldo final declarado en la cabecera de la cartola. Si no
  // coincide, el parseo se comió o duplicó algún movimiento — abortamos en
  // vez de importar, porque balanceAfter es la llave de deduplicación y un
  // saldo corrido mal generaría duplicados al reimportar.
  // Montos en CLP son enteros, así que la igualdad es exacta (sin tolerancia).
  if (foundSaldos && movements.length > 0 && Math.round(running) !== Math.round(saldoFinal)) {
    throw new Error(
      `La cartola no cuadra: el saldo posterior calculado (${Math.round(running)}) ` +
        `no coincide con el saldo final declarado (${Math.round(saldoFinal)}). ` +
        `Diferencia ${Math.round(running - saldoFinal)}. ` +
        `No se importa para no generar duplicados — revisar el archivo de cartola.`
    );
  }

  return {
    accountNumber,
    cartolaNumber,
    fechaDesde,
    fechaHasta,
    saldoInicial,
    saldoFinal,
    movements,
  };
}

// ─── Parseo de descripción ─────────────────────────────────────────────
// Formatos típicos en Santander:
//   "0771924395 Transf a Brune Spa"
//   "0795239502 Transf. INDUSTRIAL Y CO"
//   "0772707339 Transf de BLARQ SPA"  ← interna
//   "Compra SODIMAC PARQUE AR"
//   "PAGO EN LINEA PREVIRED"
//   "LIDER.CL COMPRA DIRECT"
//   "Depósito en Efectivo"
function parseDescription(desc: string): {
  counterpartyName: string | null;
  counterpartyRut: string | null;
} {
  // Patrón "RUT Transf [a|de|.] NOMBRE"
  // El "RUT" en realidad es el RUT del banco con un prefijo: ej "0772707339"
  // = 077270733-9 = BLARQ con un cero adelante. Lo guardamos así, normalización
  // futura puede convertir a formato 77270733-9.
  const transfMatch = desc.match(/^(\d{8,11}[K\d])\s+Transf[\s.]+(?:a|de)\s+(.+)$/i);
  if (transfMatch) {
    return {
      counterpartyRut: transfMatch[1],
      counterpartyName: transfMatch[2].trim(),
    };
  }
  return { counterpartyName: null, counterpartyRut: null };
}

// Sugiere categoría según patrón en la descripción. null si no se reconoce.
// MJ puede sobrescribir manualmente en la UI de conciliación.
function inferCategory(desc: string): string | null {
  const upper = desc.toUpperCase();
  if (upper.includes("PREVIRED")) return "previred";
  if (/\bCOMPRA\s/.test(upper) || upper.includes("LIDER.CL") || upper.includes("TOKU")) {
    return "compra_tarjeta";
  }
  if (upper.includes("DEPOSITO EN EFECTIVO") || upper.includes("DEPÓSITO EN EFECTIVO")) {
    return "deposito_efectivo";
  }
  if (upper.includes("TRANSF A MARIA JOSE") || upper.includes("TRANSF A JOSE TOMAS")) {
    return "sueldo";
  }
  // Comisiones bancarias típicas
  if (upper.includes("MANTENCIÓN") || upper.includes("MANTENCION") || upper.includes("COMISION")) {
    return "comision_bancaria";
  }
  return null;
}
