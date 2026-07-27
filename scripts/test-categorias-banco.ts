// Test de regresión de la lista única de categorías de banco.
//
// Qué protege: al juntar en src/lib/banco/categorias.ts las CUATRO copias que
// estaban a mano, lo derivado tiene que dar EXACTAMENTE lo mismo que decían las
// copias viejas — si no, cambia lo que MJ ve en la tabla del banco o, peor, el
// nombre de una fila del Estado de Resultado.
//
// Los valores esperados de acá abajo están copiados TEXTUALES de los mapas que
// existían antes del refactor (commit anterior a este). No los "arregles" para
// que pase el test: si uno falla, es que el refactor cambió algo.
//
// Las dos excepciones deliberadas están marcadas abajo (compra_tarjeta sale,
// reembolso_proveedor entra en la tabla), y son justamente lo que se buscaba.
//
// Uso: npx tsx scripts/test-categorias-banco.ts   (no toca la base)
import {
  CATEGORIAS_BANCO,
  OPCIONES_IMPUTACION,
  ETIQUETA_CATEGORIA,
  ETIQUETA_CATEGORIA_EERR,
  CATEGORIAS_GASTO_ESTRUCTURA,
  seccionCostoDeCategoria,
  esCategoriaBancoValida,
} from "../src/lib/banco/categorias";

let ok = 0;
let fail = 0;

function check(nombre: string, actual: unknown, esperado: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(esperado);
  if (a === e) {
    ok++;
    console.log(`  ok   ${nombre}`);
  } else {
    fail++;
    console.log(`  FALLA ${nombre}`);
    console.log(`        esperado: ${e}`);
    console.log(`        actual:   ${a}`);
  }
}

console.log("\n1. Desplegable de imputación — mismas 9 opciones, MISMO ORDEN");
// Copiado de IMPUTACION_CATEGORY_OPTIONS en banco/movimientos/page.tsx.
check("OPCIONES_IMPUTACION", OPCIONES_IMPUTACION, [
  { value: "sueldo", label: "Sueldo" },
  { value: "prestamo_socio", label: "Préstamos socios (presta o devuelve)" },
  { value: "retiro_personal", label: "Retiro socio" },
  { value: "bono_socio", label: "Bono socio" },
  { value: "previred", label: "Previred" },
  { value: "comision_bancaria", label: "Comisión banco" },
  { value: "impuestos", label: "Impuestos" },
  { value: "deposito_efectivo", label: "Depósito efectivo" },
  { value: "otro_sin_factura", label: "Otro" },
]);

console.log("\n2. Etiquetas de la tabla del banco");
// Copiado de CATEGORY_LABEL en banco/movimientos/page.tsx, con los DOS cambios
// buscados: sale compra_tarjeta (0 movimientos y 0 reglas en la base viva,
// verificado 2026-07-26) y entra reembolso_proveedor (4 movimientos que hasta
// hoy se mostraban con el texto crudo).
const ETIQUETAS_TABLA_ESPERADAS: Record<string, string> = {
  sueldo: "Sueldo",
  previred: "Previred",
  comision_bancaria: "Comisión banco",
  retiro_personal: "Retiro socio",
  bono_socio: "Bono socio",
  prestamo_socio: "Préstamos socios",
  deposito_efectivo: "Depósito efectivo",
  impuestos: "Impuestos",
  transfer_interno: "Transfer interno",
  otro_sin_factura: "Otro",
  reembolso_proveedor: "Reembolso proveedor", // nuevo
};
for (const [k, v] of Object.entries(ETIQUETAS_TABLA_ESPERADAS)) {
  check(`etiqueta tabla "${k}"`, ETIQUETA_CATEGORIA[k], v);
}
check(
  "compra_tarjeta ya no existe",
  ETIQUETA_CATEGORIA["compra_tarjeta"],
  undefined
);
check(
  "no sobra ninguna etiqueta de tabla",
  Object.keys(ETIQUETA_CATEGORIA).sort(),
  Object.keys(ETIQUETAS_TABLA_ESPERADAS).sort()
);

console.log("\n3. Etiquetas contables del Estado de Resultado (vista Caja)");
// Copiado de ETIQUETA_CATEGORIA en lib/dashboard/estadoResultadoCaja.ts. Estas
// son las que MJ lee como nombres de cuenta: no deben cambiar ni una letra.
const ETIQUETAS_EERR_ESPERADAS: Record<string, string> = {
  sueldo: "Sueldos",
  previred: "Previred",
  comision_bancaria: "Gastos financieros",
  impuestos: "Impuestos (SII)",
  retiro_personal: "Retiros de socios",
  prestamo_socio: "Préstamos de socios",
  bono_socio: "Bonos a socios",
  deposito_efectivo: "Depósito en efectivo",
  reembolso_proveedor: "Reembolso de proveedor",
  otro_sin_factura: "Otros sin factura",
};
for (const [k, v] of Object.entries(ETIQUETAS_EERR_ESPERADAS)) {
  check(`etiqueta EERR "${k}"`, ETIQUETA_CATEGORIA_EERR[k], v);
}

console.log("\n4. El PUENTE al vocabulario de las facturas");
// Copiado de getGastosBancoBlarq en proyectos/[id]/resumen/page.tsx: qué
// categorías entran al centro de costo de BLARQ y bajo qué sección.
check("CATEGORIAS_GASTO_ESTRUCTURA", CATEGORIAS_GASTO_ESTRUCTURA, [
  "sueldo",
  "previred",
  "comision_bancaria",
]);
check("puente sueldo", seccionCostoDeCategoria("sueldo"), "Sueldos");
check("puente previred", seccionCostoDeCategoria("previred"), "Previred");
check(
  "puente comision_bancaria",
  seccionCostoDeCategoria("comision_bancaria"),
  "Gastos financieros"
);
// Los impuestos NO entran (el F29 es pasa-manos, no costo de operar) y los
// pagos a socios tampoco (son reparto de utilidad / cuenta corriente).
for (const c of [
  "impuestos",
  "retiro_personal",
  "prestamo_socio",
  "bono_socio",
  "deposito_efectivo",
  "otro_sin_factura",
  "transfer_interno",
  "reembolso_proveedor",
]) {
  check(`"${c}" NO es gasto de estructura`, seccionCostoDeCategoria(c), null);
}
check("puente con null", seccionCostoDeCategoria(null), null);

console.log("\n5. Validación de lo que se guarda");
check("sueldo es válido", esCategoriaBancoValida("sueldo"), true);
check(
  "transfer_interno es válido (lo escribe el sistema)",
  esCategoriaBancoValida("transfer_interno"),
  true
);
check("compra_tarjeta ya NO es válido", esCategoriaBancoValida("compra_tarjeta"), false);
check("un typo no es válido", esCategoriaBancoValida("suledo"), false);
check("vacío no es válido", esCategoriaBancoValida(""), false);

console.log("\n6. Integridad de la lista");
check("no hay valores repetidos", CATEGORIAS_BANCO.length, new Set(CATEGORIAS_BANCO.map((c) => c.value)).size);
const conPuenteSinGasto = CATEGORIAS_BANCO.filter(
  (c) => c.seccionCosto !== null && !c.esGastoDeEstructura
);
check(
  "ninguna tiene puente sin ser gasto de estructura",
  conPuenteSinGasto.map((c) => c.value),
  []
);
const gastoSinPuente = CATEGORIAS_BANCO.filter(
  (c) => c.esGastoDeEstructura && c.seccionCosto === null
);
check(
  "toda categoría de gasto de estructura tiene su puente",
  gastoSinPuente.map((c) => c.value),
  []
);

console.log(`\n=== ${ok} ok · ${fail} fallas ===`);
process.exit(fail === 0 ? 0 : 1);
