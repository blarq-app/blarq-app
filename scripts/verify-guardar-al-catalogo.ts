/**
 * Verificación en pantalla de "Guardar al catálogo" — el botón que convierte
 * una partida armada de cero en una cotización en un molde reusable.
 *
 * Recorre el camino completo, manejando la app como MJ:
 *   1. Abre el editor de obra de un presupuesto en borrador (base de DESARROLLO).
 *   2. Crea una partida nueva a mano, con su desglose (material + mano de obra).
 *   3. Foto ANTES: el panel de la partida, con el botón "Guardar al catálogo".
 *   4. Aprieta el botón y acepta la confirmación.
 *   5. Foto DESPUÉS: el panel ya con los botones de las partidas con catálogo.
 *   6. Abre el Catálogo de Partidas en la partida nueva y la fotografía con su
 *      desglose adentro.
 *   7. Borra TODO lo que sembró (la partida de la cotización y el molde), en un
 *      finally, y lo verifica.
 *
 * Base: SOLO desarrollo (ep-solitary-mud). Aborta si el host es el de la viva.
 * La app está detrás del login y en dev no se puede tipear la clave, así que se
 * firma una cookie de sesión con el NEXTAUTH_SECRET del .env (mismo truco que
 * scripts/verify-archivar-cotizacion.ts).
 *
 * Correr con:  npx tsx scripts/verify-guardar-al-catalogo.ts [url]
 */
import "dotenv/config";
import { readFileSync, mkdirSync } from "fs";
import { chromium, type Page } from "playwright";
import hkdf from "@panva/hkdf";
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3061";
const OUT = "scripts/_capturas";

// Nombre de partida REALISTA a propósito: las capturas se las mira MJ, y un
// nombre tipo "PRUEBA GUARDAR AL CATALOGO" se lee como un rótulo de la app en
// vez de como el nombre de la partida. "(prueba)" alcanza para reconocerlo si
// algo queda vivo por un corte.
const NOMBRE = "PINTURA MURO INTERIOR (prueba)";
const CAPITULO = "INSTALACIONES ELECTRICAS"; // homologa a "INSTALACIONES ELECT."

const prisma = new PrismaClient();

const env = readFileSync("/Users/mjblanco/Desktop/blarq-app/.env", "utf8");
const SECRET = env.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/)![1].trim();

async function cookieDeSesion(): Promise<string> {
  const { EncryptJWT } = await import("jose");
  const salt = "authjs.session-token";
  const key = await hkdf(
    "sha256",
    SECRET,
    salt,
    `Auth.js Generated Encryption Key (${salt})`,
    64
  );
  return await new EncryptJWT({
    name: "MJ Blanco",
    email: "mjblanco@blarq.cl",
    sub: "verificacion",
  })
    .setProtectedHeader({ alg: "dir", enc: "A256CBC-HS512" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .setJti("verificacion-guardar-al-catalogo")
    .encrypt(key);
}

async function capturar(page: Page, nombre: string, selector?: string) {
  mkdirSync(OUT, { recursive: true });
  const ruta = `${OUT}/${nombre}.png`;
  if (selector) {
    await page.locator(selector).first().screenshot({ path: ruta });
  } else {
    await page.screenshot({ path: ruta, fullPage: false });
  }
  console.log("  capturado:", ruta);
  return ruta;
}

async function main() {
  // Guarda de base: nunca contra la viva.
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/:]+)/)?.[1] ?? "?";
  console.log("Base:", host);
  if (host.includes("shy-morning")) {
    throw new Error("ABORTA: esto siembra y borra datos, no corre contra la viva.");
  }

  // Por si una corrida anterior se cayó a la mitad.
  await limpiar();

  const bv = await prisma.budgetVersion.findFirst({
    where: {
      status: "borrador",
      obraChapters: { some: { name: CAPITULO } },
    },
    include: {
      project: { select: { id: true, name: true, numeroProyecto: true } },
      obraChapters: { where: { name: CAPITULO }, select: { id: true, name: true } },
    },
  });
  if (!bv) throw new Error(`No encontré un borrador con el capítulo ${CAPITULO}`);
  console.log(
    `Presupuesto: proyecto #${bv.project?.numeroProyecto} ${bv.project?.name} (bv ${bv.id})`
  );

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.addCookies([
    {
      name: "authjs.session-token",
      value: await cookieDeSesion(),
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  [consola]", m.text());
  });
  // Cualquier respuesta fallida se imprime CON su cuerpo: un error silencioso
  // en el editor es justo lo que hay que ver acá.
  page.on("response", async (r) => {
    if (r.status() >= 400) {
      const cuerpo = await r.text().catch(() => "");
      console.log(`  [HTTP ${r.status()}] ${r.request().method()} ${new URL(r.url()).pathname} → ${cuerpo.slice(0, 200)}`);
    }
  });
  // Las confirmaciones y avisos de la app se aceptan solos.
  page.on("dialog", async (d) => {
    console.log(`  [${d.type()}] ${d.message().split("\n")[0]}`);
    await d.accept();
  });

  try {
    // ── ANTES: el catálogo NO tiene esta partida ──────────────────────────
    await page.goto(`${BASE}/catalogo/partidas`, { waitUntil: "networkidle" });
    await page.getByPlaceholder(/buscar/i).first().fill(NOMBRE);
    await page.waitForTimeout(1200);
    await capturar(page, "gc-01-catalogo-antes");
    console.log("ANTES · catálogo sin la partida");

    // ── Crear la partida a mano en el editor ──────────────────────────────
    await page.goto(`${BASE}/proyectos/${bv.projectId}/presupuesto/${bv.id}`, {
      waitUntil: "networkidle",
    });

    // Encabezado del capítulo → su "+ Agregar" (el encabezado es un h3, no una
    // fila de la tabla, así que se llega por XPath al botón hermano).
    const btnAgregar = page.locator(
      `xpath=//h3[contains(., '${CAPITULO}')]/following-sibling::div//button[normalize-space()='+ Agregar']`
    );
    await btnAgregar.first().scrollIntoViewIfNeeded();
    await btnAgregar.first().click();
    await page.getByRole("button", { name: "Crear nueva" }).click();

    await page.getByPlaceholder("Nombre de la partida").fill(NOMBRE);
    const form = page.locator("div.bg-blue-50").first();
    await form.locator("select").selectOption("M2");
    const numeros = form.locator('input[type="number"]');
    await numeros.nth(0).fill("10"); // cantidad
    await numeros.nth(1).fill("25000"); // P. unitario
    await form.getByRole("button", { name: "Agregar", exact: true }).click();
    await page.waitForTimeout(1500);
    console.log("Partida creada a mano:", NOMBRE);

    // ── Desglose: un material del catálogo + mano de obra ─────────────────
    const fila = page.locator("tr", { hasText: NOMBRE }).first();
    await fila.scrollIntoViewIfNeeded();
    await fila.getByTitle("Ver desglose").click();
    await page.waitForTimeout(1200);

    const panel = page.locator("tr", { hasText: "Descripción para el maestro" }).first();

    // Material: se elige del catálogo de materiales, así trae su precio.
    await panel
      .getByPlaceholder(/Buscar material en el catálogo/i)
      .first()
      .fill("cemento");
    await page.waitForTimeout(1500);
    const opcion = page.locator("li, button, div[role='option']").filter({ hasText: /cemento/i }).first();
    await opcion.click();
    await page.waitForTimeout(1500);

    // Mano de obra: línea en blanco que se completa a mano. OJO: en dev cada
    // escritura tarda 3-4s. Hay que ESPERAR la respuesta HTTP de cada paso; con
    // esperas fijas se editaba una fila que todavía no existía y los PUT se
    // iban contra ids fantasma (404 en silencio, la línea quedaba en $0).
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/componentes") && r.request().method() === "POST"
      ),
      panel.getByRole("button", { name: /^\+ MANO DE OBRA$/i }).click(),
    ]);
    await page.waitForTimeout(1500);

    // La fila de mano de obra, ya existente en el DOM.
    const filaMO = panel.locator("tbody tr").filter({ hasText: /Mano de\s*Obra/i }).first();
    await filaMO.waitFor({ state: "visible" });

    async function escribir(campo: number, valor: string) {
      const input = filaMO.locator("input").nth(campo);
      await input.fill(valor);
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/componentes/") && r.request().method() === "PUT"
        ),
        input.blur(),
      ]);
      await page.waitForTimeout(800);
    }

    const totalInputs = await filaMO.locator("input").count();
    await escribir(0, "MAESTRO ELECTRICISTA"); // descripción
    await escribir(totalInputs - 2, "2"); // cantidad
    await escribir(totalInputs - 1, "45000"); // costo unitario
    await page.waitForTimeout(1500);

    // ── FOTO ANTES: el panel con el botón nuevo ───────────────────────────
    await panel.scrollIntoViewIfNeeded();
    await capturar(page, "gc-02-panel-antes", "tr:has-text('Descripción para el maestro')");
    const hayBoton = await panel
      .getByRole("button", { name: /Guardar al catálogo/i })
      .count();
    console.log("Botón 'Guardar al catálogo' visible:", hayBoton > 0);
    if (!hayBoton) throw new Error("No apareció el botón");

    // ── Apretar el botón ──────────────────────────────────────────────────
    // Se espera la RESPUESTA, no un timeout: crear el molde + copiar el
    // desglose tarda >5s en dev, y leer la base antes de que termine muestra el
    // molde a medio escribir (parece que el desglose no llegó, y sí llegó).
    const [respuesta] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/crear-en-catalogo") && r.request().method() === "POST"
      ),
      panel.getByRole("button", { name: /Guardar al catálogo/i }).click(),
    ]);
    console.log("POST crear-en-catalogo →", respuesta.status());
    await page.waitForTimeout(2000);

    // ── FOTO DESPUÉS: el panel ya con los botones de partida con catálogo ─
    await capturar(page, "gc-03-panel-despues", "tr:has-text('Descripción para el maestro')");

    const creada = await prisma.partidaCatalog.findFirst({
      where: { name: NOMBRE },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    if (!creada) throw new Error("El molde NO se creó en el catálogo");
    console.log(
      `Molde creado: ${creada.category} / ${creada.name} · $${Math.round(creada.unitPrice)} · ${creada.components.length} líneas`
    );
    for (const c of creada.components) {
      console.log(`   - ${c.type} · ${c.description} · ${c.quantity} × $${Math.round(c.unitCost)} = $${Math.round(c.totalCost)}`);
    }
    const enganchada = await prisma.obraItem.findFirst({
      where: { name: NOMBRE, budgetVersionId: bv.id },
      select: { catalogPartidaId: true },
    });
    console.log("Partida enganchada al molde:", enganchada?.catalogPartidaId === creada.id);

    // ── DESPUÉS: la partida en el Catálogo, con su desglose ───────────────
    await page.goto(`${BASE}/catalogo/partidas?focus=${creada.id}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2500);
    await capturar(page, "gc-04-catalogo-despues");

    // ── Caso "ya existe": una SEGUNDA partida con el mismo nombre en el mismo
    //    capítulo NO ofrece el botón; muestra cuál es el molde que ya está.
    await page.goto(`${BASE}/proyectos/${bv.projectId}/presupuesto/${bv.id}`, {
      waitUntil: "networkidle",
    });
    await btnAgregar.first().scrollIntoViewIfNeeded();
    await btnAgregar.first().click();
    await page.getByRole("button", { name: "Crear nueva" }).click();
    await page.getByPlaceholder("Nombre de la partida").fill(NOMBRE);
    const form2 = page.locator("div.bg-blue-50").first();
    await form2.locator('input[type="number"]').nth(0).fill("1");
    await form2.locator('input[type="number"]').nth(1).fill("1000");
    await form2.getByRole("button", { name: "Agregar", exact: true }).click();
    await page.waitForTimeout(2500);

    // La ÚLTIMA fila que además tiene el triangulito de desglose: si se filtra
    // solo por el texto, `.last()` puede caer en una fila de panel abierto.
    const fila2 = page
      .locator("tr")
      .filter({ hasText: NOMBRE })
      .filter({ has: page.getByTitle("Ver desglose") })
      .last();
    await fila2.scrollIntoViewIfNeeded();
    await fila2.getByTitle("Ver desglose").click();
    await page.waitForTimeout(3000);

    const panel2 = page.locator("tr", { hasText: "Descripción para el maestro" }).last();
    const botonRepetida = await panel2
      .getByRole("button", { name: /Guardar al catálogo/i })
      .count();
    const avisoRepetida = await panel2
      .getByText(/Ya está en el catálogo/i)
      .count();
    console.log(
      `Repetida → botón ofrecido: ${botonRepetida > 0} · aviso "ya está": ${avisoRepetida > 0}`
    );
    await capturar(page, "gc-05-panel-repetida", "tr:has-text('Descripción para el maestro')");
    if (botonRepetida > 0 || avisoRepetida === 0) {
      throw new Error("El caso repetida NO se comportó como corresponde");
    }
  } finally {
    await browser.close();
    // Todo lo sembrado se borra SIEMPRE, aunque el script se caiga a la mitad.
    await limpiar();
    await prisma.$disconnect();
  }
}

// Borra lo que siembra esta verificación: la partida de la cotización (con su
// desglose, que cae por Cascade) y el molde del catálogo. Se corre al empezar
// —por si una corrida anterior murió a la mitad— y al terminar.
async function limpiar() {
  const items = await prisma.obraItem.findMany({
    where: { name: NOMBRE },
    select: { id: true },
  });
  for (const it of items) {
    await prisma.obraItem.delete({ where: { id: it.id } });
  }
  const moldes = await prisma.partidaCatalog.findMany({
    where: { name: NOMBRE },
    select: { id: true },
  });
  for (const m of moldes) {
    await prisma.partidaCatalog.delete({ where: { id: m.id } });
  }
  if (items.length || moldes.length) {
    console.log(`Limpieza: ${items.length} partida(s) y ${moldes.length} molde(s) borrados`);
  }
  const quedan =
    (await prisma.obraItem.count({ where: { name: NOMBRE } })) +
    (await prisma.partidaCatalog.count({ where: { name: NOMBRE } }));
  if (quedan > 0) throw new Error(`Quedaron ${quedan} restos sin borrar`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
