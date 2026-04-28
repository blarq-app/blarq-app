// Cliente SimpleFactura para BLARQ.
//
// Función actual: solo lectura — pull de DTEs recibidos y emitidos.
// La emisión (que reemplazaría Maxxa) viene en una fase posterior.
//
// Auth flow (según doc oficial):
//   1. POST /token con { email, password } → devuelve { accessToken, expiresIn }
//   2. Usar accessToken como `Authorization: Bearer ...` en endpoints siguientes
//   3. El token dura 24h — lo cacheamos en memoria de proceso
//
// Operación:
//   - Si hay credenciales en `.env` (SIMPLEFACTURA_EMAIL + PASSWORD + RUT),
//     se hacen llamadas reales contra https://api.simplefactura.cl
//   - Si NO hay credenciales, el cliente entra en MODO MOCK con data sintética
//
// Endpoints que cubre (lectura):
//   - POST /documentsReceived  → facturas recibidas (requiere adicional "Bandeja de DTE recibidos")
//   - POST /documentsIssued    → facturas emitidas (incluido en plan)
//
// Si SimpleFactura responde con "Este endpoint requiere el adicional X habilitado",
// devolvemos array vacío + log — la app no se rompe, solo queda sin data
// hasta que el plan lo habilite.

const DEFAULT_BASE_URL = "https://api.simplefactura.cl";

// ─── Tipos públicos ───────────────────────────────────────────────────────
// Forma normalizada de un DTE para que la app no tenga que conocer la API
// del proveedor. Si después cambiamos de SimpleFactura a otro, solo se cambia
// este cliente — el resto de la app sigue igual.
export interface RemoteDTE {
  type: "emitida" | "recibida";
  tipoDoc: number; // 33, 34, 39, 41, 56, 61
  folioNumber: string;
  rutIssuer: string;
  rutReceiver: string;
  businessName: string;
  issueDate: string; // YYYY-MM-DD ISO
  netAmount: number;
  iva: number;
  totalAmount: number;
  siiTrackId?: string;
  xmlUrl?: string;
  pdfUrl?: string;
}

export interface FetchOptions {
  type: "emitida" | "recibida";
  fromDate: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD, default = hoy
}

// ─── Modo y credenciales ──────────────────────────────────────────────────
function getCredentials() {
  const email = process.env.SIMPLEFACTURA_EMAIL;
  const password = process.env.SIMPLEFACTURA_PASSWORD;
  const rut = process.env.SIMPLEFACTURA_RUT;
  const baseUrl = process.env.SIMPLEFACTURA_BASE_URL ?? DEFAULT_BASE_URL;
  return { email, password, rut, baseUrl };
}

export function isMockMode(): boolean {
  const { email, password, rut } = getCredentials();
  return !email || !password || !rut;
}

// ─── API pública ──────────────────────────────────────────────────────────
export async function fetchDTEs(opts: FetchOptions): Promise<RemoteDTE[]> {
  if (isMockMode()) {
    return mockDTEs(opts);
  }
  return realFetchDTEs(opts);
}

// ─── Cache JWT (proceso) ──────────────────────────────────────────────────
// El JWT dura 24h. Lo cacheamos en memoria del proceso Node para no
// loguear en cada request. Si el proceso se reinicia, el token se regenera.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const { email, password, baseUrl } = getCredentials();
  const res = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `SimpleFactura /token falló: ${res.status} — ${body.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as { accessToken: string; expiresIn: number };
  cachedToken = {
    token: data.accessToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
  };
  return data.accessToken;
}

// ─── Implementación real (SimpleFactura HTTP) ────────────────────────────
async function realFetchDTEs(opts: FetchOptions): Promise<RemoteDTE[]> {
  const { rut, baseUrl } = getCredentials();
  if (!rut) throw new Error("SIMPLEFACTURA_RUT no configurado");

  const token = await getToken();
  const path =
    opts.type === "recibida" ? "/documentsReceived" : "/documentsIssued";

  const credenciales: Record<string, string> = { rutEmisor: rut };
  if (opts.type === "emitida") credenciales.nombreSucursal = "Casa Matriz";

  const body: Record<string, unknown> = {
    credenciales,
    ambiente: 1, // 1 = producción, 0 = certificación
    folio: opts.type === "emitida" ? 0 : null,
    codigoTipoDte: null, // todos los tipos
    desde: opts.fromDate,
    hasta: opts.toDate ?? new Date().toISOString().slice(0, 10),
  };
  if (opts.type === "recibida") body.cedida = false;

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  let json: { status?: number; data?: unknown; errors?: string[] };
  try {
    json = JSON.parse(responseText);
  } catch {
    throw new Error(
      `SimpleFactura ${path} respuesta no JSON: ${res.status} — ${responseText.slice(0, 200)}`
    );
  }

  // Caso: el plan no tiene habilitado el adicional → devolvemos vacío en
  // vez de romper. Logueamos para que MJ lo vea y active el adicional.
  if (
    res.status === 400 &&
    json.errors?.some((e) => /requiere el adicional/i.test(e))
  ) {
    console.warn(
      `[SimpleFactura] ${path} bloqueado por plan: ${json.errors[0]}`
    );
    return [];
  }

  if (!res.ok || json.status !== 200) {
    throw new Error(
      `SimpleFactura ${path} falló: ${res.status} — ${JSON.stringify(json).slice(0, 300)}`
    );
  }

  const docs = Array.isArray(json.data) ? json.data : [];
  return docs.map((d) => normalizeDoc(d, opts.type));
}

// Normalización defensiva. SimpleFactura usa nombres distintos según el
// endpoint (rutProveedor en recibidas, rutReceptor en emitidas, etc).
// Mapeamos a la forma uniforme RemoteDTE.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeDoc(d: any, type: "emitida" | "recibida"): RemoteDTE {
  const { rut: ourRut } = getCredentials();
  const rutCounterparty =
    type === "recibida" ? String(d.rutProveedor ?? "") : String(d.rutReceptor ?? "");
  const businessName =
    type === "recibida"
      ? String(d.razonSocialProveedor ?? "")
      : String(d.razonSocialReceptor ?? "");

  return {
    type,
    tipoDoc: Number(d.codigoSii ?? 33),
    folioNumber: String(d.folio ?? ""),
    // Para recibidas: el emisor es el proveedor. Para emitidas: el emisor es BLARQ.
    rutIssuer: type === "recibida" ? rutCounterparty : ourRut ?? "",
    rutReceiver: type === "recibida" ? ourRut ?? "" : rutCounterparty,
    businessName,
    issueDate: parseChileanDate(String(d.fechaEmision ?? d.fechaDte ?? "")),
    netAmount: Number(d.neto ?? 0),
    iva: Number(d.iva ?? 0),
    totalAmount: Number(d.total ?? 0),
    siiTrackId: d.trackId ? String(d.trackId) : undefined,
    xmlUrl: d.xmlUrl ? String(d.xmlUrl) : undefined,
    pdfUrl: d.pdfUrl ? String(d.pdfUrl) : undefined,
  };
}

// SimpleFactura devuelve fechas tipo "30-03-2023". Las convertimos a YYYY-MM-DD.
function parseChileanDate(s: string): string {
  if (!s) return new Date().toISOString().slice(0, 10);
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return s.slice(0, 10);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// ─── MOCK ─────────────────────────────────────────────────────────────────
// Datos sintéticos para probar end-to-end antes de que el plan SimpleFactura
// tenga el adicional "Bandeja DTE recibidos" activo.
function mockDTEs(opts: FetchOptions): RemoteDTE[] {
  const seed = `${opts.type}-${opts.fromDate}`;
  const all: RemoteDTE[] = [
    {
      type: "recibida",
      tipoDoc: 33,
      folioNumber: "1145823",
      rutIssuer: "81.201.000-K",
      rutReceiver: "77.270.733-9",
      businessName: "Sodimac S.A.",
      issueDate: "2026-04-08",
      netAmount: 421008,
      iva: 79992,
      totalAmount: 501000,
      siiTrackId: `mock-${seed}-1`,
    },
    {
      type: "recibida",
      tipoDoc: 33,
      folioNumber: "8839124",
      rutIssuer: "81.201.000-K",
      rutReceiver: "77.270.733-9",
      businessName: "Sodimac S.A.",
      issueDate: "2026-04-15",
      netAmount: 982353,
      iva: 186647,
      totalAmount: 1169000,
      siiTrackId: `mock-${seed}-2`,
    },
    {
      type: "recibida",
      tipoDoc: 33,
      folioNumber: "554",
      rutIssuer: "78.456.789-1",
      rutReceiver: "77.270.733-9",
      businessName: "Comercial Easy SpA",
      issueDate: "2026-04-22",
      netAmount: 252101,
      iva: 47899,
      totalAmount: 300000,
      siiTrackId: `mock-${seed}-3`,
    },
    {
      type: "recibida",
      tipoDoc: 34,
      folioNumber: "892",
      rutIssuer: "12.345.678-9",
      rutReceiver: "77.270.733-9",
      businessName: "Roberto Mueblería",
      issueDate: "2026-04-25",
      netAmount: 5488460,
      iva: 0,
      totalAmount: 5488460,
      siiTrackId: `mock-${seed}-4`,
    },
    {
      type: "emitida",
      tipoDoc: 33,
      folioNumber: "1024",
      rutIssuer: "77.270.733-9",
      rutReceiver: "10.987.654-3",
      businessName: "Cristian Lefevre",
      issueDate: "2026-04-10",
      netAmount: 8403361,
      iva: 1596639,
      totalAmount: 10000000,
      siiTrackId: `mock-${seed}-5`,
    },
  ];

  return all.filter((d) => d.type === opts.type && d.issueDate >= opts.fromDate);
}
