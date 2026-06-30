// Robot Previred v2 — "preparado, MJ paga".
//
// MJ loguea (pone la clave). De ahí el robot hace TODO solo: navega los menús
// (Empresas -> Blarq -> Remuneraciones -> Agregar Nómina -> Ingreso Electrónico),
// llena el formulario, sube el .txt, espera a que Previred procese el archivo,
// aprieta Siguiente y lee la validación (errores/advertencias). NO paga nada.
//
// Corre LOCAL en la Mac de MJ (Previred bloquea cloud + abre popups que solo
// Playwright maneja). Navega por el TEXTO de los botones (más resistente).
//
//   npx tsx scripts/previred-cargar.ts [ruta-al-txt]

import "dotenv/config"; // carga DB viva + TELEGRAM_BOT_TOKEN (correr con DOTENV_CONFIG_PATH=.env.prod)
import { chromium, type Page, type BrowserContext } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { sendMessage } from "../src/lib/telegram/api";
import { prisma } from "../src/lib/prisma";
import { getPlanillaPreviredMes } from "../src/lib/contabilidad/remuneraciones";
import { generarArchivoPrevired } from "../src/lib/contabilidad/previredArchivo";
import { fetchIndicadoresMes } from "../src/lib/contabilidad/indicadores";

// Topes por default si no hay un mes previo del cual arrastrar (de mayo 2026).
const TOPE_GRATIFICACION_DEFAULT = 213354;
const TOPE_SALUD_UF_DEFAULT = 90;

// Asegura que el indicador del mes exista (igual que el botón "Traer indicadores"
// de la app): si falta, trae UF/UTM de internet y arrastra los topes del último
// mes conocido. Así MJ no tiene que apretar nada de indicadores.
async function asegurarIndicadores(year: number, month: number): Promise<void> {
  const existe = await prisma.indicadorMensual.findUnique({
    where: { year_month: { year, month } },
  });
  if (existe) return;
  const { uf, utm } = await fetchIndicadoresMes(year, month);
  const ultimo = await prisma.indicadorMensual.findFirst({
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  await prisma.indicadorMensual.create({
    data: {
      year, month, uf, utm,
      gratificacionTopeMensual: ultimo?.gratificacionTopeMensual ?? TOPE_GRATIFICACION_DEFAULT,
      topeImponibleSaludUF: ultimo?.topeImponibleSaludUF ?? TOPE_SALUD_UF_DEFAULT,
    },
  });
  console.log(`Indicadores de ${month}/${year} traídos automáticamente (UF ${uf}, UTM ${utm}).`);
}

// Chat de Telegram de MJ (sacado de los registros del bot de facturas).
const MJ_CHAT_ID = 5407683316;

// Mes a presentar: por args (year month) o, por default, el mes en curso.
const hoy = new Date();
const YEAR = Number(process.argv[2]) || hoy.getFullYear();
const MONTH = Number(process.argv[3]) || hoy.getMonth() + 1;
const MUTUAL_ISL = "00";

const LOGIN_URL = "https://www.previred.com/wPortal/login/login.jsp";
const OUTDIR =
  "/private/tmp/claude-501/-Users-mjblanco-Desktop-blarq-app/7b8dcedc-2b0e-411c-afaa-9ee7edabe7bb/scratchpad/previred-robot";
const NOMBRE_NOMINA = "Cotizaciones del mes"; // sin símbolos: Previred los rechaza
const EMPRESA_RUT = "77.270.733-9"; // Blarq SpA

// Genera el .txt de cotizaciones del mes desde la base VIVA y lo escribe a disco.
async function generarArchivoMes(year: number, month: number): Promise<{ path: string; total: number }> {
  const planilla = await getPlanillaPreviredMes(year, month);
  if (!planilla) throw new Error(`No hay indicadores cargados para ${month}/${year}`);
  const empleados = await prisma.empleado.findMany({ where: { activo: true } });
  const items = planilla.empleados.map((cot) => {
    const e = empleados.find((x) => x.rut === cot.rut)!;
    return {
      emp: {
        rut: e.rut, sexo: e.sexo, apellidoPaterno: e.apellidoPaterno,
        apellidoMaterno: e.apellidoMaterno, nombres: e.nombres, afpNombre: e.afpNombre,
        isapreCodigo: e.isapreCodigo, isapreFun: e.isapreFun, isaprePlanUF: e.isaprePlanUF,
      },
      cot,
    };
  });
  const contenido = generarArchivoPrevired(items, { year, month, mutualCodigo: MUTUAL_ISL });
  const path = join(OUTDIR, `previred-${year}-${String(month).padStart(2, "0")}.txt`);
  writeFileSync(path, contenido);
  return { path, total: planilla.totalGeneral };
}

// Login automático: RUT de JT (administra Blarq en Previred) + clave leída del
// llavero (Keychain) de la Mac. La clave NUNCA se loguea ni se ve; se teclea
// directo en el form. Si no hay clave guardada, el robot pide login manual.
const RUT_LOGIN = "18.022.887-K";
// Para guardar la clave UNA vez (MJ la tipea, queda cifrada en el llavero):
//   security add-generic-password -a previred-blarq -s previred-blarq -U -w
function leerClaveKeychain(): string | null {
  try {
    const v = execSync(
      'security find-generic-password -a previred-blarq -s previred-blarq -w',
      { stdio: ["ignore", "pipe", "ignore"] }
    ).toString().replace(/\n$/, "");
    return v || null;
  } catch {
    return null; // no está guardada todavía
  }
}

mkdirSync(OUTDIR, { recursive: true });

const abiertas = (ctx: BrowserContext) => ctx.pages().filter((p) => !p.isClosed());

async function shot(page: Page, nombre: string) {
  try { await page.screenshot({ path: join(OUTDIR, `${nombre}.png`) }); } catch {}
}

// Busca, entre todas las páginas/popups, la primera que tenga visible el texto
// dado (o el selector si empieza con "css:"). Espera hasta `timeoutMs`.
async function esperarEnAlgunaPagina(
  ctx: BrowserContext,
  objetivo: string,
  timeoutMs = 60_000
): Promise<{ page: Page } | null> {
  const fin = Date.now() + timeoutMs;
  const esCss = objetivo.startsWith("css:");
  const sel = esCss ? objetivo.slice(4) : "";
  while (Date.now() < fin) {
    for (const p of abiertas(ctx)) {
      try {
        if (esCss) {
          if (await p.$(sel)) return { page: p };
        } else {
          const loc = p.getByText(objetivo, { exact: false }).first();
          if (await loc.count()) {
            await loc.waitFor({ state: "visible", timeout: 800 }).catch(() => {});
            if (await loc.isVisible().catch(() => false)) return { page: p };
          }
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 800));
    if (!ctx.browser()?.isConnected()) return null;
  }
  return null;
}

// Hace click en el elemento que tenga EXACTAMENTE ese texto (por defecto), para
// no confundir el botón "Ingresar" con la frase "...haga click en Ingresar...".
// Prueba el match exacto y, si no hay, cae al parcial.
async function clickTexto(page: Page, texto: string, exact = true) {
  let loc = page.getByText(texto, { exact }).first();
  if (exact && !(await loc.count())) loc = page.getByText(texto, { exact: false }).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ timeout: 8000 });
}

async function main() {
  console.log(`Robot Previred — período ${MONTH}/${YEAR}`);
  // Asegurar indicadores del mes (trae UF/UTM si faltan) + generar el archivo.
  await asegurarIndicadores(YEAR, MONTH);
  const { path: ARCHIVO, total } = await generarArchivoMes(YEAR, MONTH);
  console.log(`Archivo generado: ${ARCHIVO} (total a pagar estimado $${total.toLocaleString("es-CL")})`);
  console.log("Abriendo Chromium...\n");
  const browser = await chromium.launch({ headless: false, args: ["--start-maximized"] });
  const ctx = await browser.newContext({ viewport: null });
  const page = await ctx.newPage();
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  // 0a. Login automático si hay clave en el llavero (si no, login manual).
  const clave = leerClaveKeychain();
  if (clave) {
    console.log("Clave encontrada en el llavero — ingresando solo...");
    try {
      await page.fill("#web_rut2", RUT_LOGIN);
      await page.fill("#web_password", clave); // NUNCA se loguea
      // Botón de login: <button id="login">INGRESAR</button>. Si el click no
      // dispara, probamos teclado (como el #crea_nomina) y Enter en la clave.
      await page.click("#login", { timeout: 4000 }).catch(async () => {
        await page.locator("#login").focus().catch(() => {});
        await page.keyboard.press("Space").catch(() => {});
        await page.locator("#web_password").press("Enter").catch(() => {});
      });
    } catch (e) {
      console.log("  No pude autologuear, seguí a mano:", (e as Error).message);
    }
  } else {
    console.log("(No hay clave en el llavero — login manual. Guardala con:");
    console.log("  security add-generic-password -a previred-blarq -s previred-blarq -U -w )");
  }

  // 0b. Esperar a estar adentro (tiles "Pago de Cotizaciones" / "Empresas").
  console.log("Esperando ingreso (pantalla de Pago de Cotizaciones)...");
  let r = await esperarEnAlgunaPagina(ctx, "Empresas", 6 * 60_000);
  if (!r) { console.log("No detecté el ingreso a tiempo."); await browser.close().catch(()=>{}); return; }
  console.log("Ingreso detectado. El robot toma el control.\n");

  try {
    // 1. Empresas (tile).
    await shot(r.page, "10-post-login");
    await clickTexto(r.page, "Empresas");
    console.log("  -> Empresas");
    r = await esperarEnAlgunaPagina(ctx, "Administrador de Empresas", 30_000) ?? r;

    // 2. Ingresar a Blarq (botón Ingresar de la fila del RUT).
    await shot(r.page, "11-admin-empresas");
    // El botón "Ingresar" está en la fila de Blarq; con una sola empresa, el
    // primer "Ingresar" es el correcto.
    await clickTexto(r.page, "Ingresar");
    console.log("  -> Ingresar (Blarq)");
    r = await esperarEnAlgunaPagina(ctx, "Pago Cotizaciones", 30_000) ?? r;

    // 3. Remuneraciones (botón del recuadro Pago Cotizaciones).
    await shot(r.page, "12-menu-empresa");
    await clickTexto(r.page, "Remuneraciones");
    console.log("  -> Remuneraciones");
    r = await esperarEnAlgunaPagina(ctx, "Agregar Nómina de Trabajadores", 30_000) ?? r;

    // 4. Agregar Nómina de Trabajadores.
    await shot(r.page, "13-pago-cotizacion");
    await clickTexto(r.page, "Agregar Nómina de Trabajadores");
    console.log("  -> Agregar Nómina de Trabajadores");
    r = await esperarEnAlgunaPagina(ctx, "Ingreso Electrónico", 30_000) ?? r;

    // 5. Ingreso Electrónico (carga por archivo).
    await shot(r.page, "14-ingreso-trabajadores");
    await clickTexto(r.page, "Ingreso Electrónico");
    console.log("  -> Ingreso Electrónico");
  } catch (e) {
    console.log("  Navegación automática falló:", (e as Error).message);
    console.log("  Si querés, navegá a mano hasta 'Ingreso de Nómina Electrónica' y el robot sigue solo.");
  }

  // 6. Esperar el formulario y llenarlo.
  const f = await esperarEnAlgunaPagina(ctx, "css:#web_combo_formato_sel", 3 * 60_000);
  if (!f) { console.log("No apareció el formulario. Abortando."); await browser.close().catch(()=>{}); return; }
  const form = f.page;
  console.log("\nFormulario detectado. Llenando...");
  await shot(form, "20-formulario");
  await form.fill("#web_nombre_nomina", NOMBRE_NOMINA).catch(() => {});
  await form.selectOption("#web_combo_tipo_nomina", "1"); // Remuneraciones
  await form.waitForTimeout(1000);
  await form.selectOption("#web_combo_formato_sel", "1"); // Estándar Separador 105
  await form.waitForTimeout(500);
  await form.setInputFiles("#web_archivo", ARCHIVO);

  // CLAVE del fix: esperar a que Previred marque el archivo como cargado
  // (el hidden #web_archivo_nomina pasa a "1") antes de apretar Siguiente.
  await form
    .waitForFunction(
      () => (document.querySelector("#web_archivo_nomina") as HTMLInputElement)?.value === "1",
      { timeout: 15_000 }
    )
    .catch(() => console.log("  (no confirmó el flag de archivo; intento igual)"));
  await form.waitForTimeout(800);
  console.log("  Formulario completo (nombre, tipo, formato, archivo).");
  await shot(form, "21-formulario-lleno");

  // Detecta la página de resultado por su TEXTO (más robusto que un id).
  const buscarResultado = async (): Promise<Page | null> => {
    for (const p of abiertas(ctx)) {
      try {
        const t = await p.evaluate(() => document.body?.innerText ?? "");
        // Caso con errores (Número de Errores / Reingresar) o caso LIMPIO
        // (resumen "Cotizaciones del mes" con "Total a pagar" y botón Aceptar).
        if (/N[úu]mero de Errores|Reingresar N[óo]mina|ingresada correctamente|se encuentra con|Total a pagar|Cotizaciones del mes/i.test(t)) return p;
      } catch {}
    }
    return null;
  };
  const esperarResultado = async (segs: number): Promise<Page | null> => {
    const fin = Date.now() + segs * 1000;
    while (Date.now() < fin) {
      const p = await buscarResultado();
      if (p) return p;
      await new Promise((r) => setTimeout(r, 1000));
      if (!browser.isConnected()) return null;
    }
    return null;
  };

  // 7. Siguiente: el botón #crea_nomina se resiste al click estándar. Probamos
  //    varias técnicas en orden hasta que una dispare la validación.
  const estrategias: { nombre: string; fn: () => Promise<void> }[] = [
    // La barra espaciadora con el botón enfocado es la que dispara (confirmado):
    // el #crea_nomina de Previred ignora el click de mouse pero acepta teclado.
    { nombre: "teclado Espacio", fn: async () => { await form.locator("#crea_nomina").focus(); await form.keyboard.press("Space"); } },
    { nombre: "teclado Enter", fn: async () => { await form.locator("#crea_nomina").focus(); await form.keyboard.press("Enter"); } },
    { nombre: "mouse real (down/up)", fn: async () => {
        const b = await form.locator("#crea_nomina").boundingBox();
        if (!b) throw new Error("sin bbox");
        await form.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await form.mouse.down(); await form.waitForTimeout(90); await form.mouse.up();
      } },
    { nombre: "click en el <span>", fn: async () => { await form.locator("#crea_nomina span").click({ force: true }); } },
    { nombre: "click forzado", fn: async () => { await form.click("#crea_nomina", { force: true }); } },
    { nombre: "click nativo JS", fn: async () => { await form.evaluate(() => (document.querySelector("#crea_nomina") as HTMLElement)?.click()); } },
  ];
  let res: { page: Page } | null = null;
  for (const e of estrategias) {
    console.log(`  Siguiente: probando '${e.nombre}'...`);
    await e.fn().catch(() => {});
    const p = await esperarResultado(8);
    if (p) { res = { page: p }; console.log(`  ¡Funcionó con '${e.nombre}'!`); break; }
  }
  if (!res) {
    console.log("  Ninguna técnica disparó el Siguiente. Apretalo vos en la ventana (una vez); sigo leyendo.");
    const p = await esperarResultado(180);
    if (p) res = { page: p };
  }
  console.log("\n================ RESULTADO ================");
  let aviso = "";
  if (res) {
    await shot(res.page, "30-resultado");
    const texto = await res.page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    const idx = texto.search(/N[úu]mero de Errores|Advertencias|correctamente|exitosa|ingresada/i);
    console.log(idx >= 0 ? texto.slice(Math.max(0, idx - 60), idx + 1200) : texto.slice(0, 1500));

    // Resumen para el aviso por Telegram. Si solo quedan errores de "Período"
    // (artefacto de probar un mes en la pantalla de otro), se considera OK.
    const mErr = texto.match(/N[úu]mero de Errores:\s*(\d+)/i);
    const nErr = mErr ? Number(mErr[1]) : 0;
    const soloPeriodo = nErr > 0 && /Periodo Remuneraciones/i.test(texto) &&
      !/(Mutual|Cotizaci[oó]n Obligatoria|FUN|Isapre|AFP)/i.test(texto);
    if (nErr === 0 || /ingresada correctamente|exitosa/i.test(texto)) {
      // Validó sin errores → registrar la planilla con "Aceptar" (deja todo
      // listo en "Planillas por Pagar"). NO es el pago. Previred ignora el click
      // de mouse en sus botones, así que usamos teclado + fallbacks.
      let registrada = false;
      try {
        const btn = res.page.getByText("Aceptar", { exact: true }).first();
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.focus().catch(() => {});
        await res.page.keyboard.press("Space").catch(() => {});
        await res.page.waitForTimeout(2500);
        if (await res.page.getByText("Total a pagar", { exact: false }).count()) {
          // todavía en el resumen: probar Enter y click forzado
          await btn.focus().catch(() => {});
          await res.page.keyboard.press("Enter").catch(() => {});
          await res.page.waitForTimeout(1500);
          await btn.click({ force: true }).catch(() => {});
          await res.page.waitForTimeout(2000);
        }
        // Si el resumen ya no está, se registró.
        registrada = (await res.page.getByText("Total a pagar", { exact: false }).count()) === 0;
        await shot(res.page, "31-post-aceptar");
      } catch {}
      aviso = registrada
        ? `Previred ${MONTH}/${YEAR}: listo. Validó sin errores y dejé la planilla registrada. Total a pagar $${total.toLocaleString("es-CL")}. Acordate de pagar antes del 13 en previred.com (Planillas por Pagar).`
        : `Previred ${MONTH}/${YEAR}: validó sin errores (total $${total.toLocaleString("es-CL")}), pero no pude apretar "Aceptar" solo. Entrá a previred.com, apretá Aceptar y pagá antes del 13.`;
    } else if (soloPeriodo) {
      aviso = `Previred ${MONTH}/${YEAR} (prueba): el archivo validó bien; solo aparece el aviso de período (${nErr}), artefacto de probar un mes en la pantalla de otro. En uso real, sin errores. Total estimado $${total.toLocaleString("es-CL")}.`;
    } else {
      aviso = `Previred: la validación marcó ${nErr} error(es) que hay que revisar antes de pagar. El robot no avanzó al pago.`;
    }
  } else {
    console.log("No pude leer el resultado solo. Mirá la captura 30 / la ventana.");
    if (abiertas(ctx)[0]) await shot(abiertas(ctx)[abiertas(ctx).length - 1], "30-estado-final");
    aviso = "Previred: el robot corrió pero no pudo leer el resultado de la validación. Revisá en previred.com.";
  }
  console.log("==========================================");

  // Aviso a MJ por Telegram (no se paga nada; solo informa).
  try {
    await sendMessage(MJ_CHAT_ID, aviso);
    console.log("Aviso enviado a MJ por Telegram.");
  } catch (e) {
    console.log("No pude enviar el aviso por Telegram:", (e as Error).message);
  }
  console.log("\nNO se pagó nada. Cerrá la ventana cuando termines.");

  const fin = Date.now() + 5 * 60_000;
  while (Date.now() < fin && browser.isConnected()) await new Promise((r) => setTimeout(r, 2000));
  await browser.close().catch(() => {});
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
