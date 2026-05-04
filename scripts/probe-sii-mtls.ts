// Probe mTLS contra subsistemas SII que aceptan cert cliente
import https from "https";
import { loadCert } from "../src/lib/sii/cert";

const { certificatePem, privateKeyPem } = loadCert();

function fetchMtls(url: string, opts: { method?: string; cookies?: string; body?: string; contentType?: string } = {}): Promise<{
  status: number; headers: Record<string,string|string[]>; body: Buffer; setCookies: string[];
}> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: opts.method ?? "GET",
      cert: certificatePem,
      key: privateKeyPem,
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "*/*",
        ...(opts.cookies ? { Cookie: opts.cookies } : {}),
        ...(opts.contentType ? { "Content-Type": opts.contentType } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode!,
        headers: res.headers as Record<string,string|string[]>,
        body: Buffer.concat(chunks),
        setCookies: (res.headers["set-cookie"] ?? []) as string[],
      }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  // Step 1: AUT2000 cert login — acepta cert via mTLS handshake
  const candidates = [
    "https://herculesr.sii.cl/cgi_AUT2000/CertSF.cgi",
    "https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi",
    "https://palena.sii.cl/cgi_AUT2000/CertSF.cgi",
    "https://misiir.sii.cl/cgi_AUT2000/CertSF.cgi",
  ];
  for (const url of candidates) {
    try {
      const r = await fetchMtls(url, { method: "GET" });
      console.log(`GET ${url}\n  → ${r.status} cookies=${r.setCookies.length} body[0:100]="${r.body.slice(0,100).toString().replace(/\s+/g," ")}"`);
      if (r.setCookies.length) {
        console.log(`  cookies: ${r.setCookies.map(c => c.split(";")[0]).join(", ")}`);
      }
    } catch (e) {
      console.log(`GET ${url} ERR ${(e as Error).message}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
