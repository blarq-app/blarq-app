// Test de regresión del cajón de fotos (2026-09-27) — CLAUDE.md §4.2.
//
// Cubre `src/lib/fotos/guardarFoto.ts`: que una foto se guarde como copia y la
// fila quede con el link a esa copia, que la misma foto no se guarde dos veces,
// que una foto que no se puede copiar quede COMO ESTABA (nunca se pierde), que
// el PDF reciba las copias incrustadas, que "Marcar como enviada" copie las
// fotos de la versión sin tocar precios, y que "Volver a lo enviado" reponga
// la copia aunque la foto de lo enviado tenga el link viejo de la tienda.
//
// Escribe y borra lo suyo (un proyecto TEST). NUNCA contra la viva: aborta si
// el host es ep-shy-morning. Pensado para una base local o la de desarrollo.
//
//   npx tsx scripts/test-fotos-guardadas.ts <ruta-env>
//
// Los casos con red (bajar una foto de MK) se saltan si no hay internet.

import { readFileSync } from "fs";

const envPath = process.argv[2];
if (!envPath) throw new Error("Falta la ruta del .env de una base de PRUEBA como argumento.");
const url = readFileSync(envPath, "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1]?.trim();
if (!url) throw new Error(`No hay DATABASE_URL en ${envPath}`);
if (/ep-shy-morning/.test(url)) throw new Error("ABORTO: este test escribe y borra — nunca contra la base viva");
// Las funciones de la app usan su propio cliente: que apunte a esta base.
process.env.DATABASE_URL = url;

let fallas = 0;
function chequear(rotulo: string, ok: boolean, detalle = "") {
  if (!ok) fallas++;
  console.log(`   ${ok ? "OK   " : "FALLA"} ${rotulo}${detalle ? ` — ${detalle}` : ""}`);
}

// PNG de 2×2 px (rojo), como si fuera una foto subida a mano.
const PNG_2X2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const f = await import("../src/lib/fotos/guardarFoto");
  const { esFotoGuardada, idDeFotoGuardada, linkEditableDeFoto } = await import("../src/lib/fotos/linkFoto");
  const { restoreArtefactosFromSnapshot } = await import("../src/lib/catalog/budgetSnapshot");
  const { leerFotoWeb } = await import("../src/lib/catalog/leerFotoWeb");
  console.log("base:", url!.match(/@([^/:]+)/)?.[1]);

  const creadas: string[] = [];
  let muerto: string | null = null; // link inventado que el caso 3 anota en una copia
  const proyecto = await prisma.project.create({
    data: { name: `TEST fotos ${Date.now()}`, clientName: "TEST", status: "cotizacion" },
  });
  try {
    console.log("\n1. Valores que no se tocan");
    chequear("null queda null", (await f.guardarCopiaDeFoto(null)) === null);
    chequear("undefined queda undefined", (await f.guardarCopiaDeFoto(undefined)) === undefined);
    chequear("vacío queda vacío", (await f.guardarCopiaDeFoto("")) === "");
    chequear("una copia queda igual", (await f.guardarCopiaDeFoto("/api/fotos/abcdefghij123")) === "/api/fotos/abcdefghij123");
    chequear(
      "host interno no se baja (queda el link)",
      (await f.guardarCopiaDeFoto("http://127.0.0.1:5432/x.jpg")) === "http://127.0.0.1:5432/x.jpg"
    );
    chequear(
      "localhost no se baja",
      (await f.guardarCopiaDeFoto("http://localhost/foto.png")) === "http://localhost/foto.png"
    );

    console.log("\n2. Subida a mano (data:)");
    const subida = `data:image/png;base64,${PNG_2X2}`;
    const s1 = await f.guardarCopiaDeFoto(subida);
    chequear("pasa a copia", esFotoGuardada(s1 as string), String(s1));
    const s2 = await f.guardarCopiaDeFoto(subida);
    chequear("la misma foto dos veces = una sola copia", s1 === s2);
    const fila = await prisma.fotoGuardada.findUnique({ where: { id: idDeFotoGuardada(s1 as string)! } });
    chequear("guardada como JPEG", fila?.mime === "image/jpeg");
    chequear("no se agranda (2×2 sigue 2×2)", fila?.width === 2 && fila?.height === 2);
    if (fila) creadas.push(fila.id);
    chequear("el campo del formulario no muestra la copia", linkEditableDeFoto(s1 as string) === "");
    chequear("ni la subida a mano", linkEditableDeFoto(subida) === "");
    chequear("un link de tienda sí se muestra", linkEditableDeFoto("https://x.cl/a.jpg") === "https://x.cl/a.jpg");

    console.log("\n3. Link de tienda (necesita internet)");
    // Foto vigente de MK leída hoy (no se deja fija: MK cambia sus fotos).
    const vigente = await leerFotoWeb("https://www.mk.cl/del360030-mamparas-dellorto-civita/p").catch(() => null);
    let copiaMk: string | null = null;
    if (!vigente) {
      console.log("   SALTADO: no se pudo leer la foto de MK (¿sin internet?)");
    } else {
      const c1 = await f.guardarCopiaDeFoto(vigente);
      chequear("link vivo → copia", esFotoGuardada(c1 as string), vigente.slice(0, 70));
      copiaMk = c1 as string;
      if (esFotoGuardada(c1 as string)) creadas.push(idDeFotoGuardada(c1 as string)!);
      const fotoMk = await prisma.fotoGuardada.findUnique({ where: { id: idDeFotoGuardada(c1 as string)! } });
      chequear("achicada a 600 px como máximo", !!fotoMk && Math.max(fotoMk.width, fotoMk.height) <= 600, `${fotoMk?.width}×${fotoMk?.height}`);
      chequear("anota el link de origen", !!fotoMk?.sourceUrls.includes(vigente));
      const cuantas = await prisma.fotoGuardada.count();
      const c2 = await f.guardarCopiaDeFoto(vigente);
      chequear("el mismo link otra vez = la misma copia, sin duplicar", c1 === c2 && (await prisma.fotoGuardada.count()) === cuantas);
      const variante = vigente.includes(".vtexassets.com/")
        ? vigente.replace(".vtexassets.com/", ".vteximg.com.br/")
        : vigente.replace(".vteximg.com.br/", ".vtexassets.com/");
      chequear(
        "el otro dominio de MK (vteximg ↔ vtexassets) se reconoce como la misma foto",
        (await f.copiasYaGuardadas([variante])).get(variante) === c1
      );
      muerto = vigente.replace(/\/ids\/\d+\//, "/ids/1/");
      chequear("link muerto → queda el link (no se pierde nada)", (await f.guardarCopiaDeFoto(muerto)) === muerto);
      await f.anotarOrigen(idDeFotoGuardada(c1 as string)!, muerto);
      chequear(
        "link muerto anotado → se reconoce como esa copia",
        (await f.guardarCopiaDeFoto(muerto)) === c1
      );
    }

    console.log("\n4. Marcar como enviada copia las fotos de la versión");
    const version = await prisma.budgetVersion.create({
      data: { projectId: proyecto.id, version: "V1", type: "artefactos", status: "borrador" },
    });
    const base = { budgetVersionId: version.id, room: "bano_principal", subcategory: "sanitario", quantity: 2, listPrice: 1000, discountPercent: 0.1, clientPrice: 900 };
    const lSubida = await prisma.artefactoItem.create({ data: { ...base, name: "SUBIDA", imageUrl: subida, sortOrder: 0 } });
    const lCopia = await prisma.artefactoItem.create({ data: { ...base, name: "YA COPIA", imageUrl: s1 as string, sortOrder: 1 } });
    const lVacia = await prisma.artefactoItem.create({ data: { ...base, name: "SIN FOTO", imageUrl: null, sortOrder: 2 } });
    const lMk = vigente
      ? await prisma.artefactoItem.create({ data: { ...base, name: "MK", imageUrl: vigente, sortOrder: 3 } })
      : null;
    const r = await f.copiarFotosDeVersion(version.id);
    chequear("sin errores", r.sinCopiar === 0, JSON.stringify(r));
    const trasEnviar = await prisma.artefactoItem.findMany({ where: { budgetVersionId: version.id } });
    const porNombre = new Map(trasEnviar.map((l) => [l.name, l]));
    chequear("la subida a mano pasó a copia", porNombre.get("SUBIDA")?.imageUrl === s1);
    chequear("la que ya era copia no cambió", porNombre.get("YA COPIA")?.imageUrl === lCopia.imageUrl);
    chequear("la vacía sigue vacía", porNombre.get("SIN FOTO")?.imageUrl === null);
    if (lMk) chequear("la de MK pasó a su copia", porNombre.get("MK")?.imageUrl === copiaMk);
    chequear(
      "precios y cantidades intactos",
      trasEnviar.every((l) => l.clientPrice === 900 && l.listPrice === 1000 && l.quantity === 2 && l.discountPercent === 0.1)
    );
    void lSubida;
    void lVacia;

    console.log("\n5. El PDF recibe las copias incrustadas");
    const paraPdf = await f.incrustarFotosGuardadas(trasEnviar);
    const pdfSubida = paraPdf.find((l) => l.name === "SUBIDA")!;
    chequear("copia → data:image/jpeg", !!pdfSubida.imageUrl?.startsWith("data:image/jpeg;base64,"));
    chequear("sin foto sigue sin foto", paraPdf.find((l) => l.name === "SIN FOTO")!.imageUrl === null);
    const conLink = await f.incrustarFotosGuardadas([{ imageUrl: "https://x.cl/a.jpg" }]);
    chequear("un link de tienda sin copia no se toca", conLink[0].imageUrl === "https://x.cl/a.jpg");

    console.log("\n6. Volver a lo enviado repone la copia aunque la foto de lo enviado tenga el link viejo");
    if (vigente && copiaMk) {
      await prisma.budgetVersion.update({
        where: { id: version.id },
        data: {
          status: "enviado",
          sentSnapshot: {
            schema: 1,
            type: "artefactos",
            artefactoItems: [{ ...base, name: "MK", detail: null, brand: null, realCostBlarq: null, referenceLink: null, imageUrl: vigente, catalogId: null, sortOrder: 0 }],
          },
        },
      });
      await restoreArtefactosFromSnapshot(version.id);
      const repuesta = await prisma.artefactoItem.findFirst({ where: { budgetVersionId: version.id } });
      chequear("la línea vuelve con la copia, no con el link", repuesta?.imageUrl === copiaMk, String(repuesta?.imageUrl));
      chequear("y con su precio", repuesta?.clientPrice === 900);
    } else {
      console.log("   SALTADO (necesita la foto de MK del caso 3)");
    }
  } finally {
    await prisma.budgetVersion.deleteMany({ where: { projectId: proyecto.id } });
    await prisma.project.delete({ where: { id: proyecto.id } });
    // El link muerto inventado no queda anotado en ninguna copia.
    if (muerto) {
      for (const c of await prisma.fotoGuardada.findMany({ where: { sourceUrls: { has: muerto } }, select: { id: true, sourceUrls: true } })) {
        await prisma.fotoGuardada.update({ where: { id: c.id }, data: { sourceUrls: { set: c.sourceUrls.filter((u) => u !== muerto) } } });
      }
    }
    // Solo se borran las copias que este test creó y que nadie más usa.
    for (const id of creadas) {
      const link = `/api/fotos/${id}`;
      const enUso =
        (await prisma.artefactoItem.count({ where: { imageUrl: link } })) +
        (await prisma.artefactoCatalog.count({ where: { imageUrl: link } })) +
        (await prisma.herrajeCatalog.count({ where: { imageUrl: link } }));
      if (enUso === 0) await prisma.fotoGuardada.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
  console.log(fallas === 0 ? "\nTODO OK" : `\n${fallas} FALLA(S)`);
  if (fallas) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
