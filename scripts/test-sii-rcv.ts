// Test del endpoint del Registro de Compras y Ventas (RCV) del SII.
// Si esto devuelve la lista de DTEs recibidos del mes, tenemos toda la
// info que necesitamos (incluyendo referencias de NCs).
//
// Endpoint: /consdcvinternetui/services/data/facadeService/getResumen
// Auth: tokenSII en payload.metaData.conversationId

import "dotenv/config";
import { randomUUID } from "crypto";
import { getSiiToken } from "../src/lib/sii/siiAuth";

const SII_BASE = "https://www4.sii.cl";
const BLARQ_RUT = 77270733;
const BLARQ_DV = "9";

async function main() {
  console.log("Obteniendo token SII...");
  const token = await getSiiToken();
  console.log(`Token: ${token}`);

  const periodo = "202604"; // abril 2026 (sabemos que hay datos)
  console.log(`\nConsultando RCV COMPRA período ${periodo}...`);

  // Body shape descubierto inspeccionando el portal real del SII vía Chrome MCP.
  // El campo `busquedaInicial: true` y `page: null` son clave — sin ellos
  // el server tira null reference exception.
  const body = {
    metaData: {
      namespace: "cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getResumen",
      conversationId: token,
      transactionId: randomUUID(),
      page: null,
    },
    data: {
      rutEmisor: String(BLARQ_RUT),
      dvEmisor: BLARQ_DV,
      ptributario: periodo,
      estadoContab: "REGISTRO",
      operacion: "COMPRA",
      busquedaInicial: true,
    },
  };

  console.log("Body:", JSON.stringify(body, null, 2));

  const res = await fetch(
    `${SII_BASE}/consdcvinternetui/services/data/facadeService/getResumen`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `TOKEN=${token}`,
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify(body),
    }
  );

  console.log(`\nStatus: ${res.status}, type: ${res.headers.get("content-type")}`);
  const summary = (await res.json()) as {
    data: Array<{ rsmnTipoDocInteger: number; rsmnTotDoc: number; rsmnMntTotal: number; dcvNombreTipoDoc: string }>;
  };
  console.log("\nResumen:");
  for (const r of summary.data) {
    console.log(`  ${r.dcvNombreTipoDoc} (${r.rsmnTipoDocInteger}): ${r.rsmnTotDoc} docs, $${r.rsmnMntTotal.toLocaleString()}`);
  }

  // Ahora pedimos el detalle de NCs (codTipoDoc=61) para ver los datos
  // que vamos a usar para auto-link.
  console.log("\n\n=== Detalle NCs recibidas (61) ===");
  const detalleBody = {
    metaData: {
      namespace: "cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDetalleCompra",
      conversationId: token,
      transactionId: randomUUID(),
      page: null,
    },
    data: {
      rutEmisor: String(BLARQ_RUT),
      dvEmisor: BLARQ_DV,
      ptributario: periodo,
      codTipoDoc: "61",
      operacion: "COMPRA",
      estadoContab: "REGISTRO",
      accionRecaptcha: "RCV_DETC",
      tokenRecaptcha: "t-o-k-e-n-web",
    },
  };

  const detRes = await fetch(
    `${SII_BASE}/consdcvinternetui/services/data/facadeService/getDetalleCompra`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `TOKEN=${token}`,
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify(detalleBody),
    }
  );
  console.log(`Status: ${detRes.status}`);
  const detalle = (await detRes.json()) as {
    data: Array<{
      detRutDoc: number;
      detDvDoc: string;
      detRznSoc: string;
      detNroDoc: number;
      detFchDoc: string;
      detMntTotal: number;
      dhdrCodigo: number;
      detCodigo: number;
    }>;
  };
  console.log(`Encontradas ${detalle.data?.length ?? 0} NCs:`);
  for (const nc of detalle.data ?? []) {
    console.log(
      `  NC folio ${nc.detNroDoc} de ${nc.detRznSoc} (${nc.detRutDoc}-${nc.detDvDoc}) — ${nc.detFchDoc} — $${nc.detMntTotal.toLocaleString()}`
    );
    console.log(`    ids: dhdrCodigo=${nc.dhdrCodigo} detCodigo=${nc.detCodigo}`);
  }
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  process.exit(1);
});
