/**
 * Cajón de fotos (2026-09-27): baja una foto una vez, la achica y la guarda en
 * la app, para que no desaparezca cuando la tienda la cambia.
 *
 * Por qué: `imageUrl` guardaba el LINK a la foto en el servidor de la tienda.
 * MK vuelve a subir sus fotos cada uno o dos meses (el `?v=` de sus links lo
 * delata) y el link viejo da 404: la foto desaparecía de la cotización y del
 * PDF. Medido en la viva el 2026-09-27: 59 líneas con la foto muerta, 14 de
 * ellas en Casa Los Algarrobos V1. Ver el modelo `FotoGuardada`.
 *
 * Regla de oro de este módulo: si algo falla (la tienda no responde, el
 * archivo no es una imagen, la base no tiene la tabla todavía), se devuelve el
 * valor que llegó, tal cual. Copiar una foto nunca puede costar perderla: en
 * el peor caso queda el link, que es lo que había antes.
 *
 * Cuándo se copia (decisión de MJ, 2026-09-27):
 *   - apenas la foto entra a la app: al guardar una línea, un producto del
 *     catálogo o un herraje (`guardarCopiaDeFoto` en cada ruta que escribe
 *     `imageUrl` con un valor nuevo);
 *   - al "Marcar como enviada" una cotización, antes de sacar su foto de lo
 *     enviado (`copiarFotosDeVersion`), por si alguna quedó como link;
 *   - y una pasada única sobre lo que ya estaba (scripts/fotos-guardar-copias.ts).
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { esHostPublico, hostDe } from "@/lib/catalog/tiendas";
import { esFotoGuardada, idDeFotoGuardada, linkDeFotoGuardada } from "./linkFoto";

type Db = PrismaClient | Prisma.TransactionClient;

// 600 px de lado es lo mismo que ya usa la subida a mano (imageThumbnail.ts).
// En el PDF la foto mide 32 mm: 600 px dan ~475 puntos por pulgada, más de lo
// que pide una imprenta (300). En la pantalla se muestra a 66 px.
const LADO_MAX = 600;
const CALIDAD_JPEG = 80;
// Límite del archivo ORIGINAL que se acepta bajar. Las fotos de las tiendas
// pesan 111 KB en promedio y la más grande medida fue de 1,5 MB.
const BYTES_MAX_ORIGEN = 20 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECCIONES = 4;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ─── Bajar y achicar ────────────────────────────────────────────────────

/**
 * Baja el archivo de una foto. Devuelve null si no se pudo o si no es imagen.
 *
 * Solo hosts públicos (`esHostPublico`, la misma guarda del proxy de fotos): la
 * app no puede servir de puente para leer direcciones internas. Por eso las
 * redirecciones se siguen a mano, revisando el host de cada salto.
 */
export async function bajarFoto(url: string): Promise<Buffer | null> {
  let actual: URL;
  try {
    actual = new URL(url);
  } catch {
    return null;
  }
  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
    if (actual.protocol !== "https:" && actual.protocol !== "http:") return null;
    const host = hostDe(actual.href);
    if (!host || !esHostPublico(host)) return null;
    let res: Response;
    try {
      res = await fetch(actual, {
        headers: { "User-Agent": BROWSER_UA, Accept: "image/*,*/*;q=0.8" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const destino = res.headers.get("location");
      if (!destino) return null;
      actual = new URL(destino, actual);
      continue;
    }
    if (!res.ok) return null;
    const tipo = (res.headers.get("content-type") ?? "").toLowerCase();
    // Algunas tiendas mandan las fotos como "application/octet-stream": se
    // aceptan igual y `achicarFoto` decide si de verdad es una imagen.
    if (tipo && !tipo.startsWith("image/") && !tipo.startsWith("application/octet-stream")) {
      return null;
    }
    const largo = Number(res.headers.get("content-length") ?? 0);
    if (largo > BYTES_MAX_ORIGEN) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > BYTES_MAX_ORIGEN) return null;
    return buf;
  }
  return null;
}

/**
 * Deja la foto lista para guardar: girada según la cámara, a 600 px de lado
 * como máximo (nunca la agranda), sobre fondo blanco (las PNG con
 * transparencia se ven igual en la tabla y en el PDF) y en JPEG.
 * Tira error si el archivo no es una imagen.
 */
export async function achicarFoto(
  original: Buffer
): Promise<{ bytes: Buffer; width: number; height: number; mime: "image/jpeg" }> {
  const { data, info } = await sharp(original, { failOn: "none" })
    .rotate()
    .resize(LADO_MAX, LADO_MAX, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: CALIDAD_JPEG, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height, mime: "image/jpeg" };
}

// ─── Guardar ────────────────────────────────────────────────────────────

/**
 * Guarda una foto (ya bajada) en el cajón y devuelve el id de su copia.
 *
 * Si la misma foto ya estaba guardada (mismo contenido), no se duplica: se
 * devuelve la que había y, si el link de origen es nuevo, se le anota.
 */
export async function guardarBytes(
  original: Buffer,
  sourceUrl: string | null,
  db: Db = prisma
): Promise<string> {
  const lista = await achicarFoto(original);
  const hash = createHash("sha256").update(lista.bytes).digest("hex");
  const anotarOrigen = async (fila: { id: string; sourceUrls: string[] }) => {
    if (sourceUrl && !fila.sourceUrls.includes(sourceUrl)) {
      await db.fotoGuardada.update({
        where: { id: fila.id },
        data: { sourceUrls: { push: sourceUrl } },
      });
    }
    return fila.id;
  };
  const existente = await db.fotoGuardada.findUnique({
    where: { hash },
    select: { id: true, sourceUrls: true },
  });
  if (existente) return anotarOrigen(existente);
  try {
    const creada = await db.fotoGuardada.create({
      data: {
        hash,
        sourceUrls: sourceUrl ? [sourceUrl] : [],
        mime: lista.mime,
        width: lista.width,
        height: lista.height,
        bytes: new Uint8Array(lista.bytes),
      },
      select: { id: true },
    });
    return creada.id;
  } catch (e) {
    // Dos guardados de la misma foto al mismo tiempo: gana el primero.
    const otra = await db.fotoGuardada.findUnique({
      where: { hash },
      select: { id: true, sourceUrls: true },
    });
    if (otra) return anotarOrigen(otra);
    throw e;
  }
}

/**
 * Anota que un link de tienda es la misma foto que una copia ya guardada.
 * Lo usa la pasada única: cuando el link guardado murió y la foto se recuperó
 * de otro lado, el link muerto queda apuntando a la copia recuperada (así una
 * pantalla abierta desde antes, que todavía tiene el link viejo, no la pisa).
 */
export async function anotarOrigen(id: string, sourceUrl: string, db: Db = prisma): Promise<void> {
  const fila = await db.fotoGuardada.findUnique({ where: { id }, select: { sourceUrls: true } });
  if (fila && !fila.sourceUrls.includes(sourceUrl)) {
    await db.fotoGuardada.update({ where: { id }, data: { sourceUrls: { push: sourceUrl } } });
  }
}

// ─── Buscar sin bajar ───────────────────────────────────────────────────

// MK y LED Studio sirven el mismo archivo desde dos dominios (el viejo
// vteximg.com.br y el nuevo vtexassets.com, ver mismaImagen.ts). Para buscar
// una copia ya guardada, se prueban las dos formas del link.
function variantesDeLink(url: string): string[] {
  if (/\.vteximg\.com\.br\//.test(url)) return [url, url.replace(/\.vteximg\.com\.br\//, ".vtexassets.com/")];
  if (/\.vtexassets\.com\//.test(url)) return [url, url.replace(/\.vtexassets\.com\//, ".vteximg.com.br/")];
  return [url];
}

/**
 * Para cada link de tienda, la copia guardada que lo reemplaza (si hay). No
 * baja nada: solo mira el cajón. Devuelve link de tienda → link a la copia.
 */
export async function copiasYaGuardadas(
  urls: (string | null | undefined)[],
  db: Db = prisma
): Promise<Map<string, string>> {
  const links = [...new Set(urls.filter((u): u is string => !!u && /^https?:\/\//i.test(u)))];
  const out = new Map<string, string>();
  if (links.length === 0) return out;
  const buscados = [...new Set(links.flatMap(variantesDeLink))];
  try {
    const filas = await db.fotoGuardada.findMany({
      where: { sourceUrls: { hasSome: buscados } },
      select: { id: true, sourceUrls: true },
    });
    for (const link of links) {
      const variantes = variantesDeLink(link);
      const fila = filas.find((f) => f.sourceUrls.some((s) => variantes.includes(s)));
      if (fila) out.set(link, linkDeFotoGuardada(fila.id));
    }
  } catch {
    // Sin tabla todavía (antes de crearla en la base) o base caída: nada guardado.
  }
  return out;
}

// ─── La puerta de entrada ───────────────────────────────────────────────

/**
 * Devuelve lo que hay que guardar en `imageUrl` para esta foto:
 *   - link a la copia guardada, si es un link de tienda o una foto subida a
 *     mano (data:) y se pudo guardar;
 *   - el mismo valor que llegó, en cualquier otro caso (vacío, ya era una
 *     copia, o no se pudo bajar/guardar).
 *
 * Respeta `undefined` (el campo no vino en el pedido) y `null` (se borró la
 * foto): los devuelve tal cual, para que la ruta no cambie su comportamiento.
 */
export async function guardarCopiaDeFoto<T extends string | null | undefined>(
  valor: T,
  db: Db = prisma
): Promise<T | string> {
  if (typeof valor !== "string") return valor;
  const url = valor.trim();
  if (!url || esFotoGuardada(url)) return valor;
  try {
    if (url.startsWith("data:")) {
      // Foto subida a mano: ya viene achicada del navegador; se mueve al
      // cajón para que la fila no cargue la imagen entera como texto.
      const coma = url.indexOf(",");
      if (coma < 0 || !url.slice(0, coma).includes(";base64")) return valor;
      const bytes = Buffer.from(url.slice(coma + 1), "base64");
      return linkDeFotoGuardada(await guardarBytes(bytes, null, db));
    }
    if (!/^https?:\/\//i.test(url)) return valor;
    const ya = (await copiasYaGuardadas([url], db)).get(url);
    if (ya) return ya;
    const bytes = await bajarFoto(url);
    if (!bytes) return valor;
    return linkDeFotoGuardada(await guardarBytes(bytes, url, db));
  } catch (e) {
    console.error("[fotos] no se pudo guardar la copia; queda el link", url.slice(0, 120), e);
    return valor;
  }
}

/**
 * Red de seguridad al "Marcar como enviada": toda línea de la versión cuya
 * foto siga siendo un link (o una subida a mano) pasa a su copia guardada,
 * ANTES de sacar la foto de lo enviado. Así lo que queda registrado como
 * enviado ya no depende de la tienda.
 *
 * Cada escritura exige que la línea siga con la foto que se miró (si alguien
 * la cambió en el medio, no se pisa). Nunca tira error: una foto que no se
 * pudo copiar queda como estaba.
 */
export async function copiarFotosDeVersion(
  budgetVersionId: string,
  db: Db = prisma
): Promise<{ copiadas: number; sinCopiar: number }> {
  let copiadas = 0;
  let sinCopiar = 0;
  try {
    const lineas = await db.artefactoItem.findMany({
      where: { budgetVersionId },
      select: { id: true, imageUrl: true },
    });
    const pendientes = [
      ...new Set(
        lineas
          .map((l) => l.imageUrl)
          .filter((u): u is string => !!u && !esFotoGuardada(u) && (/^https?:\/\//i.test(u) || u.startsWith("data:")))
      ),
    ];
    const nuevas = new Map<string, string>();
    for (let i = 0; i < pendientes.length; i += 4) {
      const lote = pendientes.slice(i, i + 4);
      const hechas = await Promise.all(lote.map((u) => guardarCopiaDeFoto(u, db)));
      lote.forEach((u, j) => {
        const nueva = hechas[j];
        if (typeof nueva === "string" && esFotoGuardada(nueva)) nuevas.set(u, nueva);
        else sinCopiar++;
      });
    }
    for (const [vieja, nueva] of nuevas) {
      const r = await db.artefactoItem.updateMany({
        where: { budgetVersionId, imageUrl: vieja },
        data: { imageUrl: nueva },
      });
      copiadas += r.count;
    }
  } catch (e) {
    console.error("[fotos] no se pudieron copiar las fotos de la versión", budgetVersionId, e);
  }
  return { copiadas, sinCopiar };
}

// ─── Para el PDF ────────────────────────────────────────────────────────

/**
 * El PDF se arma en un navegador sin sesión, que no puede pedirle la foto a
 * `/api/fotos/<id>`. Por eso las copias guardadas se incrustan en el HTML
 * (data:), leídas de una sola vez. Bonus: el PDF ya no espera a las tiendas.
 * Los links de tienda que todavía no tengan copia quedan como estaban.
 */
export async function incrustarFotosGuardadas<T extends { imageUrl: string | null }>(
  items: T[],
  db: Db = prisma
): Promise<T[]> {
  const ids = [...new Set(items.map((it) => idDeFotoGuardada(it.imageUrl)).filter((x): x is string => !!x))];
  if (ids.length === 0) return items;
  try {
    const filas = await db.fotoGuardada.findMany({
      where: { id: { in: ids } },
      select: { id: true, mime: true, bytes: true },
    });
    const porId = new Map(
      filas.map((f) => [f.id, `data:${f.mime};base64,${Buffer.from(f.bytes).toString("base64")}`])
    );
    return items.map((it) => {
      const id = idDeFotoGuardada(it.imageUrl);
      return id && porId.has(id) ? { ...it, imageUrl: porId.get(id)! } : it;
    });
  } catch (e) {
    console.error("[fotos] no se pudieron incrustar las fotos en el PDF", e);
    return items;
  }
}

/**
 * Links de tienda de los que salió cada copia guardada. Sirve para comparar con
 * la tienda: si la foto que publica hoy es una de estas, es la MISMA foto y no
 * hay nada que ofrecer. Devuelve link a la copia → links de tienda.
 */
export async function origenesDeFotos(
  urls: (string | null | undefined)[],
  db: Db = prisma
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = [...new Set(urls.map(idDeFotoGuardada).filter((x): x is string => !!x))];
  if (ids.length === 0) return out;
  try {
    const filas = await db.fotoGuardada.findMany({
      where: { id: { in: ids } },
      select: { id: true, sourceUrls: true },
    });
    for (const f of filas) out.set(linkDeFotoGuardada(f.id), f.sourceUrls);
  } catch {
    // sin tabla: ninguna copia tiene origen conocido
  }
  return out;
}
