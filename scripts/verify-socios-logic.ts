import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { esSocio, SOCIO_RUTS, SOCIO_GLOSA_HINTS } from "../src/lib/banco/socios";

// Verificación SOLO LECTURA de la lógica nueva, sin levantar la app:
//   1. La decisión del import: un "sueldo" sugerido a socio NO nace sin_factura.
//   2. La query del filtro "Transferencias a socios" devuelve lo esperado.

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^.]+)/)?.[1] ?? "?";
  console.log(`DB: ${host}\n`);

  // 1) Simular la decisión de status del import sobre los movimientos que HOY
  //    están como sueldo. Con la regla nueva, los de socio darían sin_asignar.
  const CATEGORIAS_SIN_DOCUMENTO = new Set(["previred", "sueldo"]);
  const sueldos = await prisma.bankMovement.findMany({
    where: { category: "sueldo" },
    select: { counterpartyName: true, counterpartyRut: true, description: true },
  });
  let socioSinAsignar = 0;
  let noSocioSinFactura = 0;
  for (const m of sueldos) {
    const esSueldoSocio = esSocio(m.counterpartyRut, m.counterpartyName, m.description);
    const naceSinFactura =
      CATEGORIAS_SIN_DOCUMENTO.has("sueldo") && !esSueldoSocio;
    if (esSueldoSocio && !naceSinFactura) socioSinAsignar++;
    if (!esSueldoSocio && naceSinFactura) noSocioSinFactura++;
  }
  console.log("1) Decisión de status del import (regla nueva):");
  console.log(`   sueldo→socio  que nacería 'sin_asignar' (a confirmar): ${socioSinAsignar}`);
  console.log(`   sueldo→empleado que nacería 'sin_factura' (igual que antes): ${noSocioSinFactura}`);

  // 2) Query EXACTA del filtro socios=1 (misma forma que la página).
  const filtroSocios = await prisma.bankMovement.findMany({
    where: {
      AND: [
        {
          OR: [
            ...SOCIO_RUTS.map((d) => ({ counterpartyRut: { contains: d } })),
            ...SOCIO_GLOSA_HINTS.map((n) => ({
              counterpartyName: { contains: n, mode: "insensitive" as const },
            })),
            ...SOCIO_GLOSA_HINTS.map((n) => ({
              description: { contains: n, mode: "insensitive" as const },
            })),
          ],
        },
      ],
    },
    select: { category: true, status: true, counterpartyName: true },
  });
  const noSocioColados = filtroSocios.filter(
    (m) => !esSocio(null, m.counterpartyName, m.counterpartyName)
  );
  console.log(`\n2) Filtro "Transferencias a socios" devuelve: ${filtroSocios.length} movimientos`);
  const porCat: Record<string, number> = {};
  for (const m of filtroSocios) porCat[m.category ?? "(sin categoría)"] = (porCat[m.category ?? "(sin categoría)"] ?? 0) + 1;
  console.log(`   por categoría: ${JSON.stringify(porCat)}`);
  console.log(`   (chequeo) filas que NO parecen socio por nombre: ${noSocioColados.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
