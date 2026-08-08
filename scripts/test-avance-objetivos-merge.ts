// Regresión del endpoint PUT /api/proyectos/[id]/avance-objetivos.
//
// El endpoint guarda DOS cosas en el mismo JSON (los % del avance y el tilde de
// "comparar con la versión anterior"), así que el riesgo concreto es que
// guardar una borre la otra: MJ prende el tilde y pierde los % del próximo
// avance que venía armando, o al revés. Esto lo comprueba de punta a punta
// contra un server ya levantado.
//
// Uso (contra la base DEV, nunca la viva):
//   npm run dev -- -p 3142     # en otra terminal, con .env (ep-solitary-mud)
//   npx tsx scripts/test-avance-objetivos-merge.ts 3142
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const PORT = process.argv[2] ?? "3142";
const BASE = `http://localhost:${PORT}`;
const prisma = new PrismaClient();

let fallos = 0;
function chequear(nombre: string, ok: boolean, detalle?: unknown) {
  console.log(`${ok ? "OK  " : "FALLA"}  ${nombre}`);
  if (!ok) {
    fallos++;
    if (detalle !== undefined) console.log("       →", JSON.stringify(detalle));
  }
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/.]+)/)?.[1] ?? "?";
  console.log(`Base: ${host}`);
  if (host.includes("shy-morning")) {
    throw new Error("Este test ESCRIBE: no correrlo contra la base viva.");
  }

  const user = await prisma.user.findFirst({ select: { id: true, email: true, role: true } });
  const project = await prisma.project.findFirst({
    where: { isInternal: false },
    select: { id: true, name: true, avanceObjetivos: true },
  });
  if (!user || !project) throw new Error("Falta usuario o proyecto en la base dev");
  console.log(`Proyecto de prueba: ${project.name}\n`);
  const original = project.avanceObjetivos;

  const token = await encode({
    token: { sub: user.id, email: user.email, role: user.role },
    secret: (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET)!,
    salt: "authjs.session-token",
    maxAge: 60 * 60,
  });
  const put = (body: unknown) =>
    fetch(`${BASE}/api/proyectos/${project.id}/avance-objetivos`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: `authjs.session-token=${token}` },
      body: JSON.stringify(body),
    });
  const leer = async () =>
    ((
      await prisma.project.findUnique({
        where: { id: project.id },
        select: { avanceObjetivos: true },
      })
    )?.avanceObjetivos ?? {}) as Record<string, unknown>;

  try {
    // 1. Guardar los % del avance (comportamiento de siempre).
    await put({ objetivos: { obra: 65, muebles: 40, cocina: 100 } });
    let g = await leer();
    chequear("guarda los % del avance", g.obra === 65 && g.muebles === 40 && g.cocina === 100, g);

    // 2. Prender el tilde NO puede borrar los %.
    await put({ mostrarVersionAnterior: true });
    g = await leer();
    chequear("el tilde no borra los %", g.obra === 65 && g.muebles === 40, g);
    chequear("el tilde queda guardado", g.mostrarVersionAnterior === true, g);

    // 3. Cambiar los % NO puede apagar el tilde.
    await put({ objetivos: { obra: 80, muebles: 40, cocina: 100 } });
    g = await leer();
    chequear("cambiar los % no apaga el tilde", g.mostrarVersionAnterior === true, g);
    chequear("el % nuevo se guardó", g.obra === 80, g);

    // 4. Apagar el tilde.
    await put({ mostrarVersionAnterior: false });
    g = await leer();
    chequear("el tilde se puede apagar", g.mostrarVersionAnterior === false && g.obra === 80, g);

    // 5. Basura: claves desconocidas y % fuera de rango no entran.
    await put({ objetivos: { obra: 999, inventado: 5 } });
    g = await leer();
    chequear("el % se topea en 100", g.obra === 100, g);
    chequear("las claves desconocidas se descartan", !("inventado" in g), g);
  } finally {
    // Dejar el proyecto como estaba.
    await prisma.project.update({
      where: { id: project.id },
      data: { avanceObjetivos: original ?? undefined },
    });
    console.log("\n(proyecto restaurado a su estado original)");
  }

  console.log(fallos === 0 ? "\nTodo OK" : `\n${fallos} fallas`);
  if (fallos > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
