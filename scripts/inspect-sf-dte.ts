// One-off: hace fetch real a SimpleFactura y dumpea el JSON completo de
// un DTE 61 para ver qué campo de "referencia" devuelve.

async function main() {
  const email = process.env.SIMPLEFACTURA_EMAIL;
  const password = process.env.SIMPLEFACTURA_PASSWORD;
  const rut = process.env.SIMPLEFACTURA_RUT;
  const baseUrl = process.env.SIMPLEFACTURA_BASE_URL;
  if (!email || !password || !rut || !baseUrl) {
    console.error("Faltan credenciales SF");
    process.exit(1);
  }

  // Token
  const tokRes = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const tokJson = (await tokRes.json()) as { accessToken?: string; token?: string; data?: { token?: string } };
  const token = tokJson.accessToken ?? tokJson.token ?? tokJson.data?.token;
  if (!token) {
    console.error("No token", tokJson);
    process.exit(1);
  }

  // Fetch recibidas de marzo 2026 (donde MJ tiene NCs)
  const body = {
    credenciales: { rutEmisor: rut },
    ambiente: 1,
    desde: "2026-01-01",
    hasta: "2026-04-30",
  };
  const res = await fetch(`${baseUrl}/documentsReceived`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: unknown[] };
  if (!Array.isArray(json.data)) {
    console.error("No hay data", json);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ncs = (json.data as any[]).filter((d) => Number(d.codigoSii) === 61);
  console.log(`Encontradas ${ncs.length} NCs.`);
  for (const nc of ncs) {
    const refs = nc.referencias ?? [];
    console.log(`  Folio ${nc.folio} de ${nc.razonSocialProveedor}: ${refs.length} refs ${refs.length > 0 ? JSON.stringify(refs[0]) : ""}`);
  }
  // Mostrar la primera NC con refs no vacías, si la hay
  const ncWithRef = ncs.find((n) => Array.isArray(n.referencias) && n.referencias.length > 0);
  if (ncWithRef) {
    console.log("\n=== NC con referencias ===");
    console.log(JSON.stringify(ncWithRef, null, 2));
  } else {
    console.log("\nNinguna NC trae referencias pobladas en /documentsReceived.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
