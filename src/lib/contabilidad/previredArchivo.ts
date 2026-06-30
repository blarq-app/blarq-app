// Generador del archivo de pago de cotizaciones para PREVIRED.
//
// Formato oficial "Estándar Largo Variable, por separador" (versión 95, mayo
// 2026): un registro (línea) por trabajador, 105 campos separados por ";".
// Campos numéricos = enteros sin separador de miles; alfanuméricos sin blancos
// pegados al separador. Los campos no aplicables van en 0 (numérico) o vacío
// (alfanumérico).
//
// Códigos de entidad del documento oficial: AFP Planvital = 29; Isapre Colmena
// = 04; Mutual: 01 ACHS, 02 Mutual de Seguridad CCHC, 03 IST; CCAF: 00 = sin
// CCAF; Régimen = AFP; Tipo nómina 01 = remuneraciones del mes.
//
// ESTADO: validado contra el validador real de PREVIRED (carga de prueba, sin
// pagar, 2026-06-30). Hallazgos aplicados:
//   - Campo 76 (FUN Isapre): NO se exige — el validador no lo marcó con FUN vacío.
//   - Campo 79 (cotización UF, 4 decimales con coma): aceptado.
//   - Mutual: BLARQ está en ISL (Instituto de Seguridad Laboral), NO en mutual
//     privada. Tabla N°19: código 00 = "Sin Mutual, aporte de accidentes al ISL".
//     Con ISL, la cotización de accidentes va en el campo 71 (Acc. Trabajo ISL),
//     NO en el 98 (Mutual). El 96/97/98 van en 00/0/0 y se llena el 64 (renta
//     imponible ISL, obligatorio cuando el 71 > 0).
//   - Campo 28 (cotización obligatoria AFP): debe INCLUIR el 0,1% adicional de
//     la reforma (cargo del empleador). No cambia lo que paga BLARQ (ese 0,1%
//     ya estaba en el total AFP), solo el casillero del archivo.
//   - Campo 25 (Subsidio Trabajador Joven): "N" explícito (Tabla N°9).

import type { CotizacionEmpleado } from "./previred";

// Mapa nombre AFP -> código Previred (Tabla N°10).
const AFP_CODIGOS: Record<string, string> = {
  cuprum: "03",
  habitat: "05",
  provida: "08",
  planvital: "29",
  capital: "33",
  modelo: "34",
  uno: "35",
};

export type EmpleadoPrevired = {
  rut: string; // con o sin formato; se limpia acá
  sexo: string | null; // "M" / "F"
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
  nombres: string | null;
  afpNombre: string | null;
  isapreCodigo: string | null; // ej "04"
  isapreFun: string | null;
  isaprePlanUF: number;
};

export type ArchivoConfig = {
  year: number;
  month: number;
  mutualCodigo: string; // ej "02" Mutual CCHC
};

// Separa RUT en cuerpo numérico + dígito verificador.
function partirRut(rut: string): { num: string; dv: string } {
  const limpio = rut.replace(/[.\s]/g, "").toUpperCase();
  const [cuerpo, dv] = limpio.split("-");
  return { num: (cuerpo ?? "").replace(/\D/g, ""), dv: dv ?? "" };
}

function periodo(year: number, month: number): string {
  return `${String(month).padStart(2, "0")}${year}`; // mmaaaa
}

// Genera la línea de 105 campos de un trabajador.
export function generarLineaTrabajador(
  emp: EmpleadoPrevired,
  cot: CotizacionEmpleado,
  cfg: ArchivoConfig
): string {
  const { num: rutNum, dv } = partirRut(emp.rut);
  const afpCodigo = AFP_CODIGOS[(emp.afpNombre ?? "").toLowerCase().trim()] ?? "29";
  const imp = String(cot.imponible);

  // Cotización pactada de salud, en UF con coma decimal (campo 79).
  const planUF = emp.isaprePlanUF.toFixed(4).replace(".", ",");

  // ¿La empresa entrega el aporte de accidentes al ISL (código 00) en vez de a
  // una mutual privada? BLARQ está en ISL. Con ISL la cotización de accidentes
  // va en el campo 71 (y obliga el 64); el bloque Mutual (96/97/98) va en 00/0/0.
  const esISL = cfg.mutualCodigo === "00";

  // 105 campos en orden. Empezamos todos vacíos y llenamos los que aplican.
  const c: string[] = new Array(105).fill("");
  const set = (n: number, v: string | number) => {
    c[n - 1] = String(v);
  };

  // 1-25 Datos del trabajador
  set(1, rutNum);
  set(2, dv);
  set(3, emp.apellidoPaterno ?? "");
  set(4, emp.apellidoMaterno ?? "");
  set(5, emp.nombres ?? "");
  set(6, emp.sexo ?? "");
  set(7, "0"); // Chileno
  set(8, "01"); // Remuneraciones del mes
  set(9, periodo(cfg.year, cfg.month));
  set(10, ""); // Período hasta (no aplica)
  set(11, "AFP");
  set(12, "0"); // Activo
  set(13, "30"); // Días trabajados
  set(14, "00"); // Línea principal
  set(15, "0"); // Sin movimiento
  set(16, "");
  set(17, "");
  set(18, "D"); // Tramo asignación familiar: sin derecho
  set(19, "0");
  set(20, "0");
  set(21, "0");
  set(22, "0");
  set(23, "0");
  set(24, "0");
  set(25, "N"); // Subsidio Trabajador Joven: no (Tabla N°9)

  // 26-39 AFP
  set(26, afpCodigo);
  set(27, imp); // Renta imponible AFP / Seguro Social
  // Cotización obligatoria AFP: 10% + comisión + 0,1% adicional de la reforma.
  // Previred exige el 0,1% sumado acá (lo verificó su validador). No cambia lo
  // que paga BLARQ — ese 0,1% ya estaba contado en el total AFP.
  set(28, String(cot.afpTrabajador + cot.afpEmpleador));
  set(29, String(cot.sis)); // SIS (empleador)
  set(30, "0");
  set(31, "0");
  set(32, "00,00");
  set(33, "0");
  set(34, "00");
  set(38, "00,00");
  set(39, "0");

  // 40-49 APVI / APVC (no aplica)
  set(40, "000");
  set(42, "0");
  set(43, "0");
  set(44, "0");
  set(45, "000");
  set(47, "0");
  set(48, "0");
  set(49, "0");

  // 50-61 Afiliado voluntario (no aplica)
  set(50, "0");
  set(55, "0");
  set(58, "0");
  set(59, "0");
  set(60, "0");
  set(61, "0");

  // 62-74 IPS/ISL/Fonasa (no aplica — está en AFP/Isapre/Mutual)
  set(62, "0000");
  set(63, "00,00");
  // Renta imponible ISL (campo 64): obligatoria cuando se informa la cotización
  // de accidentes al ISL (campo 71). Para régimen AFP el tope es el de AFP.
  set(64, esISL ? imp : "0");
  set(65, "0");
  set(66, "0");
  set(67, "0000");
  set(68, "00,00");
  set(69, "0");
  set(70, "0");
  // Cotización accidentes del trabajo al ISL (campo 71): el monto va acá cuando
  // la empresa no está en mutual privada (BLARQ = ISL). Si fuera mutual, va 0.
  set(71, esISL ? String(cot.mutual) : "0");
  set(72, "0");
  set(73, "0");
  set(74, "0");

  // 75-82 Salud (Isapre)
  set(75, emp.isapreCodigo ?? "04");
  set(76, emp.isapreFun ?? "");
  set(77, imp);
  set(78, "2"); // Moneda del plan: UF
  set(79, planUF);
  // Cotización obligatoria 7% y adicional. saludTrabajador = plan completo.
  const saludLegal = Math.round(cot.imponible * 0.07);
  set(80, String(saludLegal));
  set(81, String(Math.max(0, cot.saludTrabajador - saludLegal)));
  set(82, "0");

  // 83-93 CCAF (no aplica) + jornada
  set(83, "00"); // Sin CCAF
  set(84, "0");
  set(85, "0");
  set(86, "0");
  set(87, "0");
  set(88, "0");
  set(89, "0");
  set(90, "0");
  set(91, "0");
  set(92, "0");
  set(93, "1"); // Jornada completa

  // 94-95 Seguro Social (reforma) + rentabilidad protegida
  set(94, String(cot.seguroSocial)); // Expectativa de Vida 0,9% (empleador)
  set(95, "0");

  // 96-99 Mutualidad. Con ISL (código 00) este bloque va en 0 — el accidente se
  // informó en el campo 71. Con mutual privada, acá va el código, la renta
  // imponible y la cotización de accidentes.
  set(96, cfg.mutualCodigo);
  set(97, esISL ? "0" : imp);
  set(98, esISL ? "0" : String(cot.mutual));
  set(99, ""); // Sucursal (condicional)

  // 100-102 Seguro de cesantía (AFC)
  set(100, imp);
  set(101, String(cot.cesantiaTrabajador)); // 0,6%
  set(102, String(cot.cesantiaEmpleador)); // 2,4%

  // 103-105
  set(103, "0");
  set(104, "");
  set(105, "");

  return c.join(";");
}

// Genera el archivo completo (una línea por trabajador, separadas por salto de
// línea). Devuelve el contenido del .txt.
export function generarArchivoPrevired(
  empleados: { emp: EmpleadoPrevired; cot: CotizacionEmpleado }[],
  cfg: ArchivoConfig
): string {
  return empleados.map(({ emp, cot }) => generarLineaTrabajador(emp, cot, cfg)).join("\r\n") + "\r\n";
}
