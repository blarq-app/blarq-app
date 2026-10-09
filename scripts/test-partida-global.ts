/**
 * Regresión de la pendiente 156: pasar una partida a GL (y volver) sin que el
 * total se mueva. Pura, sin base de datos.
 *
 *   npx tsx scripts/test-partida-global.ts
 *
 * Los casos "reales" copian el desglose de Casa Los Algarrobos V4 tal como
 * estaba en la base viva el 2026-10-08 (lectura con scripts/diag-156-medir*.ts).
 */
import {
  pasarAGlobal,
  reescalarPartida,
  lineasGlobalesMultiplicadas,
  avisoGlobal,
  textoAvisoGlobal,
  type PartidaReescalable,
} from "../src/lib/presupuesto/partidaGlobal";
import { precioPorUnidad, type ComponenteCalculable } from "../src/lib/catalog/effectiveTotal";

let fallas = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log("  ✓ " + msg);
  else {
    fallas++;
    console.log("  ✗ FALLÓ: " + msg);
  }
}
const cerca = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

type Comp = ComponenteCalculable & { description: string };
let n = 0;
function c(
  type: string,
  description: string,
  quantity: number,
  unit: string,
  unitCost: number,
  extra: Partial<Comp> = {}
): Comp {
  return {
    id: `c${++n}`,
    type,
    description,
    quantity,
    unit,
    unitCost,
    appliedToComponentId: null,
    appliedToType: null,
    ...extra,
  };
}
function partida(quantity: number, comps: Comp[]): PartidaReescalable {
  const pu = precioPorUnidad(comps);
  return {
    quantity,
    unitPrice: pu,
    costMaterial: null,
    costLabor: null,
    costTools: null,
    costSubcontract: null,
    costLoss: null,
    costMargin: null,
  };
}
function aplicar(comps: Comp[], lineas: { id: string; despues: number }[]): Comp[] {
  return comps.map((x) => {
    const l = lineas.find((y) => y.id === x.id);
    return l ? { ...x, quantity: l.despues } : x;
  });
}

// ───────────────────────────────────────────────────────────────────────────
console.log("1. Pasar a GL conserva el total (pérdida a un material, pérdida a todos, leyes, margen):");
{
  const porcelanato = c("material", "PORCELANATO", 1, "M2", 25000);
  const pegamento = c("material", "PEGAMENTO", 0.5, "UN", 10000);
  const comps = [
    porcelanato,
    c("perdida", "PERDIDA 10% porcelanato", 10, "%", 0, { appliedToComponentId: porcelanato.id }),
    pegamento,
    c("perdida", "PERDIDA 5% todos", 5, "%", 0, { appliedToType: "material" }),
    c("mano_obra", "CERAMISTA", 1, "GL", 130000),
    c("mano_obra", "LEYES SOCIALES 20%", 20, "%", 0, { appliedToType: "mano_obra" }),
    c("mano_obra", "LEYES SOCIALES viejas (0%)", 0, "%", 180),
    c("margen", "MARGEN", 10, "%", 0),
  ];
  const item = partida(2.7, comps);
  const totalAntes = item.unitPrice * 2.7;
  const r = pasarAGlobal(item, comps);
  assert(r.ok, "convierte");
  if (r.ok) {
    assert(r.cantidadDespues === 1, "la cantidad queda en 1");
    assert(cerca(r.totalDespues, totalAntes), `total igual: ${Math.round(totalAntes)} → ${Math.round(r.totalDespues)}`);
    assert(cerca(r.precioUnitarioDespues, totalAntes), "el P.U. nuevo es el total (cantidad 1)");
    const despues = aplicar(comps, r.lineas);
    assert(cerca(precioPorUnidad(despues) * 1, totalAntes), "recalculando el desglose nuevo da el mismo total");
    const porId = new Map(despues.map((x) => [x.description, x.quantity]));
    assert(cerca(porId.get("PORCELANATO")!, 2.7, 1e-9), "porcelanato 1 → 2,7");
    assert(cerca(porId.get("PEGAMENTO")!, 1.35, 1e-9), "pegamento 0,5 → 1,35");
    assert(cerca(porId.get("CERAMISTA")!, 2.7, 1e-9), "CERAMISTA GL 1 → 2,7 (se ve que se estaba cobrando 2,7 veces)");
    assert(porId.get("PERDIDA 10% porcelanato") === 10, "pérdida % a un material no se toca (sigue 10)");
    assert(porId.get("PERDIDA 5% todos") === 5, "pérdida % a todos los materiales no se toca");
    assert(porId.get("LEYES SOCIALES 20%") === 20, "leyes sociales % no se tocan");
    assert(porId.get("LEYES SOCIALES viejas (0%)") === 0, "leyes viejas en 0% no se tocan");
    assert(porId.get("MARGEN") === 10, "margen % no se toca");
    assert(r.lineas.length === 3, "solo cambian las 3 líneas fijas");
  }
}

console.log("\n2. Después de pasar a GL, el CERAMISTA en $130.000 una sola vez baja el total lo que corresponde:");
{
  const mat = c("material", "MATERIAL", 1, "M2", 40000);
  const ceramista = c("mano_obra", "CERAMISTA", 1, "GL", 130000);
  const comps = [mat, ceramista, c("margen", "MARGEN", 10, "%", 0)];
  const item = partida(2.7, comps);
  const totalAntes = item.unitPrice * 2.7; // (40.000 + 130.000) × 1,1 × 2,7 = 504.900
  assert(cerca(totalAntes, 504900), `antes: $504.900 (130.000 × 2,7 = 351.000 de ceramista)`);
  const r = pasarAGlobal(item, comps);
  assert(r.ok && cerca(r.totalDespues, 504900), "pasada a GL: sigue en $504.900");
  if (r.ok) {
    const despues = aplicar(comps, r.lineas).map((x) => (x.id === ceramista.id ? { ...x, quantity: 1 } : x));
    const totalFinal = precioPorUnidad(despues) * 1;
    // 40.000 × 2,7 = 108.000 + 130.000 = 238.000 × 1,1 = 261.800
    assert(cerca(totalFinal, 261800), `CERAMISTA 1 GL: $261.800 (baja 1,7 × 130.000 × 1,1 = $243.100)`);
  }
}

console.log("\n3. Cantidad 1 o 0:");
{
  const comps = [c("material", "X", 2, "UN", 1000), c("margen", "M", 10, "%", 0)];
  const r1 = pasarAGlobal(partida(1, comps), comps);
  assert(r1.ok && r1.lineas.every((l) => l.antes === l.despues) && r1.factor === 1, "cantidad 1: no cambia ninguna línea");
  const r0 = pasarAGlobal(partida(0, comps), comps);
  assert(!r0.ok, "cantidad 0: se niega (si no, el desglose quedaría en 0)");
}

console.log("\n4. Partida sin desglose (montos a mano):");
{
  const item: PartidaReescalable = {
    quantity: 4,
    unitPrice: 15000,
    costMaterial: 5000,
    costLabor: 8000,
    costTools: 0,
    costSubcontract: null,
    costLoss: 500,
    costMargin: 1500,
  };
  const r = pasarAGlobal(item, []);
  assert(r.ok, "convierte");
  if (r.ok) {
    assert(cerca(r.totalDespues, 60000), "total 4 × 15.000 = $60.000 se conserva");
    assert(r.montosSinDesglose?.unitPrice === 60000, "P.U. 15.000 → 60.000");
    assert(r.montosSinDesglose?.costLabor === 32000, "mano de obra 8.000 → 32.000");
    assert(r.montosSinDesglose?.costSubcontract === 0, "un monto vacío queda en 0");
  }
}

console.log("\n5. Volver de GL a una unidad (dividir) y la ida y vuelta:");
{
  const mat = c("material", "PLACA", 0.5, "UN", 20160);
  const comps = [
    mat,
    c("perdida", "PERDIDA", 20, "%", 0, { appliedToType: "material" }),
    c("mano_obra", "MAESTRO", 1, "GL", 60000),
    c("margen", "MARGEN", 28.861, "%", 0),
  ];
  const item = partida(10, comps);
  const total = item.unitPrice * 10;
  const ida = pasarAGlobal(item, comps);
  assert(ida.ok && cerca(ida.totalDespues, total), "10 → 1 GL conserva el total");
  if (ida.ok) {
    const enGL = aplicar(comps, ida.lineas);
    const vuelta = reescalarPartida({ ...item, quantity: 1, unitPrice: precioPorUnidad(enGL) }, enGL, 10);
    assert(vuelta.ok && cerca(vuelta.totalDespues, total), "1 GL → 10 conserva el total");
    if (vuelta.ok) {
      const final = aplicar(enGL, vuelta.lineas);
      assert(
        final.every((x, i) => cerca(x.quantity, comps[i].quantity, 1e-9)),
        "la ida y vuelta deja las cantidades como estaban"
      );
    }
  }
}

console.log("\n6. Línea \"%\" vieja que vale plata (leyes 1% × $2.000, Francisco de Aguirre) también se conserva:");
{
  const comps = [
    c("mano_obra", "MAESTRO", 1, "M2", 10000),
    c("mano_obra", "LEYES SOCIALES", 1, "%", 2000),
    c("margen", "MARGEN", 20, "%", 0),
  ];
  const item = partida(3, comps);
  const r = pasarAGlobal(item, comps);
  assert(r.ok && cerca(r.totalDespues, item.unitPrice * 3), "total igual");
  assert(r.ok && r.lineas.length === 2, "se multiplican el maestro y esas leyes (son monto fijo)");
}

console.log("\n7. Aviso de línea GL multiplicada:");
{
  const comps = [
    c("material", "PLACA", 0.5, "UN", 20160),
    c("mano_obra", "MAESTRO", 1, "GL", 60000),
    c("mano_obra", "VACÍA", 1, "GL", 0),
  ];
  assert(lineasGlobalesMultiplicadas(10, comps).map((x) => x.description).join() === "MAESTRO", "cantidad 10: avisa el MAESTRO GL (no la línea en $0)");
  assert(lineasGlobalesMultiplicadas(1, comps).length === 0, "cantidad 1: no avisa");
  assert(lineasGlobalesMultiplicadas(10, [c("mano_obra", "x", 1, "gl", 5)]).length === 1, "reconoce \"gl\" en minúscula");
  assert(lineasGlobalesMultiplicadas(0, comps).length === 0, "cantidad 0: no avisa (todavía no se cobra nada)");
  assert(
    lineasGlobalesMultiplicadas(3, [
      c("mano_obra", "Mano de obra (monto original)", 1, "GL", 25000),
      c("margen", "Margen (monto original)", 1, "GL", 3000),
    ]).length === 0,
    "no avisa las líneas \"(monto original)\" que la app sembró: son por unidad"
  );
}

console.log("\n7b. Aviso ámbar completo (avisoGlobal + texto):");
{
  const comps = [
    c("material", "PLACA", 0.5, "UN", 20160),
    c("mano_obra", "MAESTRO", 1, "GL", 60000),
    c("margen", "MARGEN", 20, "%", 0),
  ];
  const techumbre = avisoGlobal({ unit: "GL", quantity: 10 }, comps);
  assert(!!techumbre && techumbre.partidaEnGL, "TECHUMBRE 10 GL: avisa por la partida");
  assert(techumbre?.montoLineas === 600000, "y el MAESTRO GL suma $600.000 en la partida");
  assert(
    !!techumbre && textoAvisoGlobal(techumbre) === "La partida está en GL con cantidad 10: se cobra 10 veces.",
    "texto de la partida en GL"
  );
  const porcelanato = avisoGlobal({ unit: "M2", quantity: 2.7 }, [
    c("material", "PORCELANATO", 1, "M2", 25000),
    c("mano_obra", "CERAMISTA", 1, "GL", 130000),
  ]);
  assert(!!porcelanato && !porcelanato.partidaEnGL, "partida en M2 con una línea GL: avisa por la línea");
  assert(
    !!porcelanato && textoAvisoGlobal(porcelanato) === "CERAMISTA está en GL y se cobra 2,7 veces.",
    "texto de una línea (con coma decimal)"
  );
  assert(cerca(porcelanato?.montoLineas ?? 0, 351000), "el CERAMISTA suma $351.000 en la partida");
  const dos = avisoGlobal({ unit: "UN", quantity: 4 }, [
    c("mano_obra", "MAESTRO", 1, "GL", 20000),
    c("mano_obra", "PINTOR", 1, "GL", 120000),
  ]);
  assert(
    !!dos && textoAvisoGlobal(dos) === "MAESTRO y PINTOR están en GL y se cobran 4 veces.",
    "texto de dos líneas"
  );
  assert(avisoGlobal({ unit: "GL", quantity: 1 }, comps) === null, "1 GL: sin aviso");
  assert(avisoGlobal({ unit: "M2", quantity: 48 }, [c("material", "X", 0.7, "UN", 6800)]) === null, "48 M2 sin líneas GL: sin aviso");
  const bano = avisoGlobal({ unit: "GL", quantity: 3 }, [c("mano_obra", "Mano de obra (monto original)", 1, "GL", 88000)]);
  assert(!!bano && bano.partidaEnGL && bano.lineas.length === 0, "baño 3 GL con monto original: avisa por la partida, no por la línea");
}

console.log("\n8. Datos reales — Casa Los Algarrobos V4, 2.3 TECHUMBRE (10 GL, $1.115.048):");
{
  const comps = [
    c("material", "PLACA TERCIADO ESTRUCTURAL 18MM", 0.5, "UN", 20160),
    c("material", "PERFIL METALCON OMEGA", 0.5, "UN", 4866),
    c("material", "PERFIL METALCON EST. C", 0.33, "UN", 7555),
    c("material", "AISLANGLASS R122", 0.04, "UN", 52933),
    c("material", "PERFIL METALCON PORTANTE", 1, "UN", 1672),
    c("material", "VOLCANITA ST 10MM", 0.5, "UN", 5538),
    c("material", "CABEZA LENTEJA", 0.05, "UN", 8395),
    c("material", "TORNILLO AUTOPERFORANTE", 0.1, "UN", 9824),
    c("mano_obra", "MAESTRO", 1, "GL", 60000),
    c("mano_obra", "LEYES SOCIALES", 0, "%", 1500),
    c("margen", "MARGEN", 28.861, "%", 1893),
    c("perdida", "PERDIDA DE MATERIAL", 20, "%", 0, { appliedToType: "material" }),
  ];
  const item = partida(10, comps);
  const total = item.unitPrice * 10;
  assert(cerca(total, 1115048, 5), `el desglose da el total guardado ($${Math.round(total)})`);
  const r = pasarAGlobal(item, comps);
  assert(r.ok && cerca(r.totalDespues, total), "pasada a GL: mismo total");
  if (r.ok) {
    const maestro = r.lineas.find((l) => l.despues === 10);
    assert(!!maestro, "el MAESTRO GL queda en 10 (se veía 1 pero se cobraba 10 veces)");
  }
}

console.log("\n9. Datos reales — Casa Los Algarrobos V4, 4.21 PORCELANATO TIPO LADRILLO (2,7 M2, $346.679):");
{
  const comps = [
    c("material", "PROVISION PORCELANATO LADRILLO", 1, "UN", 57143),
    c("perdida", "PERDIDA DE MATERIAL", 10, "%", 267, { appliedToType: "material" }),
    c("material", "SIKACERAM 110 EXTRA SACO 25KG", 0.5, "UN", 10000),
    c("perdida", "PERDIDA DE MATERIAL", 5, "%", 36),
    c("material", "ESPACIADOR CON TOMADOR 3MM", 0.3, "UN", 1975),
    c("material", "FRAGUE BEKRON BOLSA 5KG", 0.02, "UN", 6421),
    // Hoy el CERAMISTA está en $48.148 por M2 (= $130.000 / 2,7): ya se
    // corrigió a mano. Cuando se escribió la pendiente estaba en GL × $130.000.
    c("mano_obra", "CERAMISTA", 1, "M2", 48148),
    c("mano_obra", "LEYES SOCIALES", 0, "%", 180),
    c("margen", "MARGEN", 10, "%", 520),
  ];
  const item = partida(2.7, comps);
  const total = item.unitPrice * 2.7;
  assert(cerca(total, 346679, 5), `el desglose da el total guardado ($${Math.round(total)})`);
  const r = pasarAGlobal(item, comps);
  assert(r.ok && cerca(r.totalDespues, total), "pasada a GL: mismo total");
  if (r.ok) {
    const cer = r.lineas.find((l) => l.antes === 1 && cerca(l.despues, 2.7, 1e-9));
    assert(!!cer, "CERAMISTA 1 → 2,7 M2 × $48.148 = $130.000");
  }
}

console.log(fallas === 0 ? "\nTODO OK." : `\n${fallas} FALLAS.`);
if (fallas > 0) process.exit(1);
