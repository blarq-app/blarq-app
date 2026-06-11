/**
 * Proxy de imágenes de catálogo.
 *
 * Por qué: las fotos de los artefactos viven en CDNs de las tiendas
 * (mkchile.vtexassets.com, etc.). Cargan bien por HTTP, pero algunos
 * navegadores con bloqueadores de anuncios/privacidad bloquean esos
 * dominios de CDN, así que a la usuaria se le ven "rotas". Sirviendo la
 * imagen a través de NUESTRO dominio, el navegador nunca le pide nada al
 * CDN → no hay nada que bloquear.
 *
 * GET /api/catalogo/img-proxy?u=<url de imagen externa, URL-encoded>
 *
 * Seguridad: solo se permiten hosts de tiendas conocidas (evita SSRF /
 * que se use como proxy abierto).
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Hosts permitidos (la tienda y su CDN de assets). Se acepta el host exacto
// o cualquier subdominio.
const ALLOWED_HOSTS = [
  "mk.cl",
  "vtexassets.com",
  "vteximg.com.br",
  "sodimac.cl",
  "sodimac.com",
  "easy.cl",
  "falabella.com",
  "scene7.com",
  "cdn.shopify.com", // Kitchen House (Teka) — su tienda corre en Shopify
];

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u) return new NextResponse("falta u", { status: 400 });

  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return new NextResponse("url inválida", { status: 400 });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return new NextResponse("protocolo no permitido", { status: 400 });
  }
  const host = url.hostname.replace(/^www\./, "");
  const allowed = ALLOWED_HOSTS.some(
    (a) => host === a || host.endsWith("." + a)
  );
  if (!allowed) return new NextResponse("host no permitido", { status: 403 });

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": BROWSER_UA, Accept: "image/*" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return new NextResponse("no encontrada", { status: res.status });
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) {
      return new NextResponse("no es imagen", { status: 415 });
    }
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": ct,
        // Cache agresivo: las imágenes de catálogo no cambian seguido.
        "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    });
  } catch {
    return new NextResponse("error al traer la imagen", { status: 502 });
  }
}
