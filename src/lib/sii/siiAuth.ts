// Autenticación con el SII (Servicio de Impuestos Internos de Chile) usando
// cert digital del representante legal. Esto es la base para descargar XMLs
// de DTEs recibidos directamente del portal SII (sin pasar por SimpleFactura).
//
// Flow estándar (descrito en docs SII):
//
//   1. GET /DTEWS/CrSeed.jws → devuelve XML SOAP con un "seed" (string aleatorio)
//   2. Construir XML:
//        <getToken>
//          <item><Semilla>{seed}</Semilla></item>
//        </getToken>
//      y firmarlo con XMLDSig usando la private key del cert digital.
//   3. POST /DTEWS/GetTokenFromSeed.jws con el XML firmado adentro de un SOAP.
//   4. Respuesta SOAP contiene el `<TOKEN>...</TOKEN>` que vive ~30 min.
//
// Endpoints producción: palena.sii.cl
// Endpoints certificación: maullin.sii.cl  (para tests, NO usado acá)
//
// El token devuelto se cachea en memoria del proceso. Después se usa como
// parameter `tokenSII` en consultas a otros endpoints del SII.

import { SignedXml } from "xml-crypto";
import { parseStringPromise } from "xml2js";
import { loadCert } from "./cert";

const SII_HOST = "https://palena.sii.cl"; // producción

// Cache de token por proceso. SII no documenta TTL exacto; típicamente ~30 min.
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getSiiToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const seed = await fetchSeed();
  const signedXml = signSeedRequest(seed);
  const token = await fetchToken(signedXml);

  cachedToken = { token, expiresAt: Date.now() + 25 * 60_000 }; // refrescar cada 25 min
  return token;
}

// ─── 1. Pedir seed ─────────────────────────────────────────────────────────
async function fetchSeed(): Promise<string> {
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:def="http://DefaultNamespace">
  <soapenv:Header/>
  <soapenv:Body>
    <def:getSeed/>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(`${SII_HOST}/DTEWS/CrSeed.jws`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: soapBody,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SII /CrSeed.jws falló: ${res.status} — ${txt.slice(0, 300)}`);
  }

  const xml = await res.text();
  // El SII devuelve el seed dentro de un string XML escapado como entidades
  // HTML (no CDATA). Por eso buscamos SEMILLA con `&lt;` o `<` indistintamente.
  const seedMatch =
    xml.match(/&lt;SEMILLA&gt;([^&]+)&lt;\/SEMILLA&gt;/) ??
    xml.match(/<SEMILLA>([^<]+)<\/SEMILLA>/);
  if (!seedMatch) {
    throw new Error(`SII /CrSeed.jws sin SEMILLA en respuesta: ${xml.slice(0, 600)}`);
  }
  return seedMatch[1];
}

// ─── 2. Firmar el seed con XMLDSig ─────────────────────────────────────────
function signSeedRequest(seed: string): string {
  const { privateKeyPem, certificatePem } = loadCert();

  const xmlToSign = `<getToken><item><Semilla>${seed}</Semilla></item></getToken>`;

  const sig = new SignedXml({ privateKey: privateKeyPem });
  sig.addReference({
    xpath: "//*[local-name(.)='getToken']",
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
    transforms: ["http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
  });
  sig.canonicalizationAlgorithm = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
  sig.signatureAlgorithm = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";

  // Embeber el cert público en KeyInfo para que el SII pueda verificar la firma.
  const certBase64 = certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;

  sig.computeSignature(xmlToSign, { location: { reference: "//*[local-name(.)='getToken']", action: "append" } });
  return sig.getSignedXml();
}

// ─── 3. Posts seed firmado y obtener token ─────────────────────────────────
async function fetchToken(signedXml: string): Promise<string> {
  // El SII recibe el XML firmado dentro de un parámetro `pszXml` que es
  // ese mismo XML escapado como CDATA dentro del SOAP envelope.
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:def="http://DefaultNamespace">
  <soapenv:Header/>
  <soapenv:Body>
    <def:getToken>
      <pszXml><![CDATA[${signedXml}]]></pszXml>
    </def:getToken>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(`${SII_HOST}/DTEWS/GetTokenFromSeed.jws`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: soapBody,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SII /GetTokenFromSeed.jws falló: ${res.status} — ${txt.slice(0, 500)}`);
  }

  const xml = await res.text();
  // Idem que en fetchSeed: la respuesta del SII viene con entidades HTML.
  const tokenMatch =
    xml.match(/&lt;TOKEN&gt;([^&]+)&lt;\/TOKEN&gt;/) ??
    xml.match(/<TOKEN>([^<]+)<\/TOKEN>/);
  if (!tokenMatch) {
    const estadoMatch =
      xml.match(/&lt;ESTADO&gt;([^&]+)&lt;\/ESTADO&gt;/) ??
      xml.match(/<ESTADO>([^<]+)<\/ESTADO>/);
    const glosaMatch =
      xml.match(/&lt;GLOSA&gt;([^&]+)&lt;\/GLOSA&gt;/) ??
      xml.match(/<GLOSA>([^<]+)<\/GLOSA>/);
    throw new Error(
      `SII no devolvió TOKEN. Estado: ${estadoMatch?.[1] ?? "?"}, Glosa: ${glosaMatch?.[1] ?? "?"}. Raw: ${xml.slice(0, 600)}`
    );
  }
  return tokenMatch[1];
}

// Helper de diagnóstico: parsear el SOAP entero (útil si algo falla y queremos
// ver toda la respuesta cruda en estructura JSON).
export async function parseSoapXml(xml: string): Promise<unknown> {
  return parseStringPromise(xml);
}
