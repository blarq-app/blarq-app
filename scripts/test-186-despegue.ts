/**
 * "No sigue al catálogo" solo cuando MJ decide el precio (pendiente 186).
 *
 * Una línea de artefactos se despegaba del catálogo por cosas que NO eran una
 * decisión de MJ —aplicar el precio que publica la tienda, por ejemplo— y una
 * vez despegada no había forma de volver a conectarla. En Casa Los Algarrobos
 * V4 quedaron 30 despegadas y solo 5 eran decisión suya.
 *
 * Lo que quedó (2026-09-25): aplicar la tienda no despega y reconecta;
 * "Comparar con mi catálogo" NO toca marcas (el catálogo está atrasado
 * respecto de la tienda y MJ verifica contra la web); y el PRECIO del catálogo
 * baja a las cotizaciones solo cuando cambia, no en cada guardado.
 *
 * Este test pega contra las rutas REALES, mandando lo mismo que manda el
 * editor (la fila completa + el campo de la acción), y revisa en la base cómo
 * quedaron las dos marcas:
 *   priceOverridden    → "no sigue al catálogo" (MJ fijó un PRECIO)
 *   discountOverridden → "el descuento lo puso MJ"
 *
 * OJO al armar casos: el guardado copia el precio a las otras líneas del MISMO
 * producto (mismo catalogId o mismo nombre) dentro de la cotización. Por eso
 * cada caso usa su propio producto de catálogo; si no, un caso le pisa las
 * líneas a otro.
 *
 * Crea todo lo que necesita y lo borra al final. Nunca contra la base viva.
 *
 *   npx tsx scripts/test-186-despegue.ts <url-app> <env-con-DATABASE_URL>
 *   npx tsx scripts/test-186-despegue.ts http://localhost:3186 scripts/_tmp186/local.env
 */
import { readFileSync } from "fs";
import hkdf from "@panva/hkdf";
import { PrismaClient, type ArtefactoItem } from "@prisma/client";

const [BASE, envDb] = process.argv.slice(2);
if (!BASE || !envDb) throw new Error("uso: <url-app> <env-con-DATABASE_URL>");
const leer = (ruta: string, clave: string) =>
  readFileSync(ruta, "utf8").match(new RegExp(`${clave}\\s*=\\s*"?([^"\\n]+)"?`))?.[1]?.trim();
const DB = leer(envDb, "DATABASE_URL");
// El secreto con que firma la app: el .env de la carpeta principal (el mismo
// que usan los otros tests del editor).
const SECRET = leer("/Users/mjblanco/Desktop/blarq-app/.env", "NEXTAUTH_SECRET");
if (!DB || !SECRET) throw new Error("Falta DATABASE_URL o NEXTAUTH_SECRET.");
if (/shy-morning/.test(DB) || !/localhost|127\.0\.0\.1|solitary-mud/.test(DB))
  throw new Error("Solo contra una base local o la de desarrollo. Abortado.");
const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

let ok = 0;
let fail = 0;
function check(nombre: string, cond: boolean, detalle = "") {
  if (cond) ok++;
  else fail++;
  console.log(`  ${cond ? "OK  " : "FALL"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}
const CLP = (n: number | null | undefined) =>
  n == null ? "—" : "$" + Math.round(n).toLocaleString("es-CL");
const PCT = (d: number | null | undefined) => `${Math.round((d ?? 0) * 1000) / 10}%`;
const cerca = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 1;

async function cookie(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf("sha256", SECRET!, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
  return await new EncryptJWT({ name: "MJ Blanco", email: "mjblanco@blarq.cl", sub: "test-186" })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("test-186-despegue")
    .encrypt(key);
}
let ck = "";
async function pedir(metodo: string, ruta: string, cuerpo?: unknown) {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", Cookie: `authjs.session-token=${ck}` },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(`${metodo} ${ruta} → ${res.status}`);
  return res.json();
}
const releer = (id: string) => prisma.artefactoItem.findUniqueOrThrow({ where: { id } });

// Guarda una línea como lo hace el editor: la FILA COMPLETA con el cambio
// aplicado (el precio a cliente recalculado si se movió la lista o el
// descuento), más los campos de acción que correspondan.
async function guardar(
  bvId: string,
  id: string,
  cambio: Partial<ArtefactoItem>,
  accion: Record<string, unknown> = {}
): Promise<ArtefactoItem> {
  const fila = await releer(id);
  const nueva = { ...fila, ...cambio };
  if (cambio.listPrice !== undefined || cambio.discountPercent !== undefined) {
    nueva.clientPrice = nueva.listPrice * (1 - (nueva.discountPercent ?? 0));
  }
  await pedir("PUT", `/api/presupuestos/${bvId}/artefactos/${id}`, { ...nueva, ...accion });
  return releer(id);
}

async function main() {
  console.log("Base:", DB!.match(/@([^/]+)/)?.[1], "· App:", BASE, "\n");
  ck = await cookie();

  const proyecto = await prisma.project.create({
    data: { name: "__TEST_186_DESPEGUE__", clientName: "__TEST__", status: "cotizacion" },
  });
  const bv = await prisma.budgetVersion.create({
    data: { projectId: proyecto.id, version: "V1", type: "artefactos", status: "borrador" },
  });
  const catIds: string[] = [];
  const producto = async (name: string, listPrice: number, discountPercent: number) => {
    const c = await prisma.artefactoCatalog.create({
      data: { name, subcategory: "sanitario", listPrice, discountPercent },
    });
    catIds.push(c.id);
    return c;
  };
  let orden = 0;
  const linea = (datos: Partial<ArtefactoItem> & { name: string; catalogId: string | null }) =>
    prisma.artefactoItem.create({
      data: {
        budgetVersionId: bv.id,
        room: "bano_principal",
        subcategory: "sanitario",
        quantity: 1,
        listPrice: 100000,
        discountPercent: 0.2,
        clientPrice: 80000,
        priceOverridden: false,
        discountOverridden: false,
        sortOrder: orden++,
        ...datos,
      },
    });
  const deLaTienda = { precioDeLaTienda: true, descuentoDeLaTienda: true };

  try {
    // ── 1. Aplicar el precio de la tienda NO despega ─────────────────────
    console.log("1. Aplica desde 'Comparar con la tienda web' lista y descuento nuevos:");
    const p1 = await producto("ZZ186 UNO", 100000, 0.2);
    const a = await linea({ name: "ZZ186 UNO", catalogId: p1.id });
    let d = await guardar(bv.id, a.id, { listPrice: 110000, discountPercent: 0.25 }, deLaTienda);
    check("toma el precio de la tienda", cerca(d.clientPrice, 82500), `${CLP(d.listPrice)} · ${PCT(d.discountPercent)} · ${CLP(d.clientPrice)}`);
    check("sigue al catálogo (no se despega)", d.priceOverridden === false);
    check("el descuento no queda como de MJ", d.discountOverridden === false);

    // ── 2. ...y si ya estaba despegada, la vuelve a conectar ─────────────
    console.log("\n2. Lo mismo sobre una línea que YA no seguía al catálogo:");
    const p2 = await producto("ZZ186 DOS", 200000, 0.3);
    const b = await linea({
      name: "ZZ186 DOS", catalogId: p2.id, listPrice: 250000, discountPercent: 0.3,
      clientPrice: 175000, priceOverridden: true,
    });
    d = await guardar(bv.id, b.id, { listPrice: 210000, discountPercent: 0.35 }, deLaTienda);
    check("toma el precio de la tienda", cerca(d.clientPrice, 136500), CLP(d.clientPrice));
    check("vuelve a seguir al catálogo", d.priceOverridden === false);

    // ── 3. Las copias del mismo producto van parejas ─────────────────────
    console.log("\n3. Copias del mismo producto (otro baño, y otra con el mismo nombre sin catálogo):");
    const p3 = await producto("ZZ186 TRES", 100000, 0.2);
    const c0 = await linea({ name: "ZZ186 TRES", catalogId: p3.id });
    const c1 = await linea({ name: "ZZ186 TRES", catalogId: p3.id, room: "bano_visita", priceOverridden: true });
    const c2 = await linea({ name: "ZZ186 TRES", catalogId: null, room: "cocina", priceOverridden: true });
    await guardar(bv.id, c0.id, { listPrice: 120000, discountPercent: 0.25 }, deLaTienda);
    const e1 = await releer(c1.id);
    const e2 = await releer(c2.id);
    check("la copia del otro baño recibe el precio", cerca(e1.clientPrice, 90000), CLP(e1.clientPrice));
    check("...y vuelve a seguir al catálogo", e1.priceOverridden === false);
    check("la del mismo nombre recibe el precio", cerca(e2.clientPrice, 90000), CLP(e2.clientPrice));
    check("...y tampoco queda despegada", e2.priceOverridden === false);

    // ── 4. Aplicar solo la FOTO no cambia ninguna marca ──────────────────
    console.log("\n4. Aplica solo la FOTO en una línea con descuento puesto por MJ:");
    const p4 = await producto("ZZ186 CUATRO", 100000, 0.2);
    const f = await linea({
      name: "ZZ186 CUATRO", catalogId: p4.id, discountPercent: 0.45, clientPrice: 55000,
      discountOverridden: true, imageUrl: "https://ejemplo.cl/vieja.jpg",
    });
    // Lo que manda el editor cuando solo se marcó la imagen: sin campos de
    // acción de precio, porque no se aplicó ningún precio.
    d = await guardar(bv.id, f.id, { imageUrl: "https://ejemplo.cl/nueva.jpg" });
    check("la foto queda", d.imageUrl === "https://ejemplo.cl/nueva.jpg");
    check("el 45% sigue siendo de MJ", d.discountOverridden === true && cerca(d.clientPrice, 55000), PCT(d.discountPercent));
    check("y la línea sigue al catálogo", d.priceOverridden === false);

    // ── 5. Tienda sin descuento publicado: solo la lista ─────────────────
    console.log("\n5. Aplica solo la LISTA (tienda que no publica el descuento) con descuento de MJ:");
    const p5 = await producto("ZZ186 CINCO", 100000, 0.2);
    const g = await linea({
      name: "ZZ186 CINCO", catalogId: p5.id, discountPercent: 0.45, clientPrice: 55000,
      discountOverridden: true,
    });
    d = await guardar(bv.id, g.id, { listPrice: 120000 }, { precioDeLaTienda: true });
    check("toma la lista nueva con el 45% de MJ", cerca(d.clientPrice, 66000), CLP(d.clientPrice));
    check("el 45% sigue marcado como de MJ", d.discountOverridden === true);
    check("y no se despega", d.priceOverridden === false);

    // ── 6. Tipear la LISTA a mano SÍ despega (no cambia) ─────────────────
    console.log("\n6. MJ tipea un precio de LISTA a mano:");
    const p6 = await producto("ZZ186 SEIS", 200000, 0.3);
    const h = await linea({ name: "ZZ186 SEIS", catalogId: p6.id, listPrice: 200000, discountPercent: 0.3, clientPrice: 140000 });
    const h2 = await linea({ name: "ZZ186 SEIS", catalogId: p6.id, room: "bano_visita", listPrice: 200000, discountPercent: 0.3, clientPrice: 140000 });
    d = await guardar(bv.id, h.id, { listPrice: 180000 });
    check("queda su precio", cerca(d.clientPrice, 126000), CLP(d.clientPrice));
    check("no sigue al catálogo", d.priceOverridden === true);
    const eh2 = await releer(h2.id);
    check("la copia del otro baño también queda fija", eh2.priceOverridden === true && cerca(eh2.clientPrice, 126000));

    // ── 7. Tipear el DESCUENTO a mano: marca de MJ, sin despegar ─────────
    console.log("\n7. MJ tipea un DESCUENTO a mano:");
    const p7 = await producto("ZZ186 SIETE", 100000, 0.2);
    const k = await linea({ name: "ZZ186 SIETE", catalogId: p7.id });
    d = await guardar(bv.id, k.id, { discountPercent: 0.1 });
    check("queda su 10%", cerca(d.clientPrice, 90000), `${PCT(d.discountPercent)} · ${CLP(d.clientPrice)}`);
    check("marcado como descuento de MJ", d.discountOverridden === true);
    check("la lista sigue al catálogo", d.priceOverridden === false);

    // ── 8. "Comparar con mi catálogo" NO toca las marcas (como siempre) ──
    // Se evaluó que reconectara y se descartó: el catálogo está atrasado
    // respecto de la tienda, y MJ verifica contra la web.
    console.log("\n8. 'Comparar con mi catálogo' baja el precio a una línea despegada con descuento propio:");
    const p8 = await producto("ZZ186 OCHO", 200000, 0.3);
    const m = await linea({
      name: "ZZ186 OCHO", catalogId: p8.id, listPrice: 250000, discountPercent: 0.1,
      clientPrice: 225000, priceOverridden: true, discountOverridden: true,
    });
    await pedir("POST", `/api/presupuestos/${bv.id}/artefactos/actualizar-catalogo`, {
      patches: [{ itemId: m.id, listPrice: 200000, discountPercent: 0.3 }],
    });
    d = await releer(m.id);
    check("toma el precio del catálogo", cerca(d.clientPrice, 140000), `${CLP(d.listPrice)} · ${PCT(d.discountPercent)} · ${CLP(d.clientPrice)}`);
    check("sigue sin seguir al catálogo (no la reconecta)", d.priceOverridden === true);
    check("la marca del descuento no se toca", d.discountOverridden === true);

    // ── 9. ...pero bajar solo el COSTO no toca las marcas ────────────────
    console.log("\n9. 'Comparar con mi catálogo' baja solo el COSTO:");
    const p9 = await producto("ZZ186 NUEVE", 200000, 0.3);
    const n = await linea({
      name: "ZZ186 NUEVE", catalogId: p9.id, listPrice: 250000, discountPercent: 0.1,
      clientPrice: 225000, priceOverridden: true, discountOverridden: true,
    });
    await pedir("POST", `/api/presupuestos/${bv.id}/artefactos/actualizar-catalogo`, {
      patches: [{ itemId: n.id, realCostBlarq: 99000 }],
    });
    d = await releer(n.id);
    check("el costo queda", d.realCostBlarq === 99000);
    check("sigue sin seguir al catálogo", d.priceOverridden === true);
    check("el descuento sigue siendo de MJ", d.discountOverridden === true);

    // ── 10. Resguardo: guardar el producto SIN cambiar su precio ─────────
    // Antes cada guardado del catálogo bajaba el precio: arreglar la foto le
    // pisaba a la cotización el precio de la tienda con el del catálogo (que
    // puede estar atrasado). Ahora baja la foto y el precio se queda.
    console.log("\n10. En el catálogo se cambia solo la FOTO del producto del caso 1:");
    const cat1 = await prisma.artefactoCatalog.findUniqueOrThrow({ where: { id: p1.id } });
    await pedir("PUT", `/api/catalogo/artefactos/${p1.id}`, { ...cat1, imageUrl: "https://ejemplo.cl/foto-arreglada.jpg" });
    d = await releer(a.id);
    check("la línea conserva el precio de la tienda", cerca(d.clientPrice, 82500), `${CLP(d.clientPrice)} (el catálogo dice ${CLP(cat1.listPrice * (1 - (cat1.discountPercent ?? 0)))})`);
    check("pero recibe la foto nueva", d.imageUrl === "https://ejemplo.cl/foto-arreglada.jpg");

    // ── 11. Cambiar el PRECIO en el catálogo sí baja a las conectadas ────
    console.log("\n11. Cambia el PRECIO en el catálogo (lista 220.000, 30%):");
    for (const p of [p1, p2, p6, p8]) {
      const cat = await prisma.artefactoCatalog.findUniqueOrThrow({ where: { id: p.id } });
      await pedir("PUT", `/api/catalogo/artefactos/${p.id}`, { ...cat, listPrice: 220000, discountPercent: 0.3 });
    }
    check("la del caso 1 (precio de la tienda, conectada) lo toma", cerca((await releer(a.id)).clientPrice, 154000), CLP((await releer(a.id)).clientPrice));
    check("la reconectada desde la tienda (caso 2) lo toma", cerca((await releer(b.id)).clientPrice, 154000), CLP((await releer(b.id)).clientPrice));
    check("la bajada con 'Comparar con mi catálogo' (caso 8) NO se mueve", cerca((await releer(m.id)).clientPrice, 140000), CLP((await releer(m.id)).clientPrice));
    check("la tipeada a mano (caso 6) NO se mueve", cerca((await releer(h.id)).clientPrice, 126000), CLP((await releer(h.id)).clientPrice));

    // ── 12. Versión nueva: se copian LAS DOS marcas ──────────────────────
    console.log("\n12. Se crea una versión nueva a partir de esta:");
    const v2 = (await pedir("POST", "/api/presupuestos", {
      projectId: proyecto.id, type: "artefactos", baseVersionId: bv.id,
    })) as { id: string };
    const copiaDcto = await prisma.artefactoItem.findFirstOrThrow({ where: { budgetVersionId: v2.id, name: "ZZ186 SIETE" } });
    const copiaMano = await prisma.artefactoItem.findFirstOrThrow({ where: { budgetVersionId: v2.id, name: "ZZ186 SEIS", room: "bano_principal" } });
    check("el descuento de MJ sigue marcado en la versión nueva", copiaDcto.discountOverridden === true);
    check("el precio tipeado sigue sin seguir al catálogo", copiaMano.priceOverridden === true);

    // ── 13. "Volver a lo enviado" también devuelve las dos marcas ────────
    console.log("\n13. Se envía la versión nueva, se toca, y se vuelve a lo enviado:");
    await pedir("PUT", `/api/presupuestos/${v2.id}`, { status: "enviado" });
    await prisma.artefactoItem.update({ where: { id: copiaDcto.id }, data: { discountOverridden: false } });
    await pedir("POST", `/api/presupuestos/${v2.id}/restaurar-enviado`);
    const restaurada = await prisma.artefactoItem.findFirstOrThrow({ where: { budgetVersionId: v2.id, name: "ZZ186 SIETE" } });
    check("el descuento vuelve marcado como de MJ", restaurada.discountOverridden === true);
    check("y con su 10%", cerca(restaurada.clientPrice, 90000), CLP(restaurada.clientPrice));
  } finally {
    await prisma.budgetVersion.deleteMany({ where: { projectId: proyecto.id } });
    await prisma.project.delete({ where: { id: proyecto.id } }).catch(() => {});
    await prisma.artefactoCatalog.deleteMany({ where: { id: { in: catIds } } });
    console.log("\nDatos de prueba borrados.");
  }

  console.log("─".repeat(60));
  console.log(`RESULTADO: ${ok} OK, ${fail} FALL`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
