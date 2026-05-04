// Carga del certificado digital del representante legal de BLARQ.
//
// El cert digital chileno viene en formato PKCS#12 (.pfx o .p12) protegido
// por una contraseña. Adentro contiene:
//   - Private key (RSA) — usada para firmar
//   - Certificate (X.509) — la identidad pública con el RUT del titular
//
// Usamos node-forge porque es la única lib Node madura que parsea P12 sin
// llamar a openssl. La operación es 100% local — el cert nunca se manda
// a ningún servidor externo.
//
// Variables de entorno requeridas (en .env local + Vercel):
//   SII_CERT_PATH     — path al archivo .pfx, o (en Vercel) base64 de su contenido
//   SII_CERT_PASSWORD — password del cert
//   SII_CERT_BASE64   — alternativa a SII_CERT_PATH para producción serverless
//
// En dev local: SII_CERT_PATH apunta al .pfx en disco.
// En Vercel: SII_CERT_BASE64 contiene el cert codificado en base64 (no se
// puede subir un archivo binario como env var, así que se lo serializa).

import { readFileSync } from "fs";
import forge from "node-forge";

export interface CertBundle {
  privateKey: forge.pki.rsa.PrivateKey;
  certificate: forge.pki.Certificate;
  rutHolder: string; // RUT extraído del cert, formato "12345678-9"
  privateKeyPem: string; // PEM-encoded para libs de firma
  certificatePem: string;
}

let cached: CertBundle | null = null;

/**
 * Carga el cert una sola vez por proceso (cache en memoria).
 */
export function loadCert(): CertBundle {
  if (cached) return cached;

  const password = process.env.SII_CERT_PASSWORD;
  if (!password) {
    throw new Error("SII_CERT_PASSWORD no configurado en .env");
  }

  // Leer el binario del cert. Soporta dos modos: path o base64.
  let p12Bytes: Buffer;
  if (process.env.SII_CERT_BASE64) {
    p12Bytes = Buffer.from(process.env.SII_CERT_BASE64, "base64");
  } else if (process.env.SII_CERT_PATH) {
    p12Bytes = readFileSync(process.env.SII_CERT_PATH);
  } else {
    throw new Error(
      "Debe configurarse SII_CERT_PATH (dev) o SII_CERT_BASE64 (prod)"
    );
  }

  // Parsear el PKCS#12 con la password.
  const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12Bytes.toString("binary")));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

  // Extraer la key privada y los certificados. Un .pfx típicamente trae
  // 3 certs: el del titular + la cadena de CAs (intermediaria + raíz). El
  // del titular es el único que NO tiene basicConstraints.cA=true. Los
  // otros son las CAs y no nos interesan para identificar al titular.
  let privateKey: forge.pki.rsa.PrivateKey | null = null;
  const certificates: forge.pki.Certificate[] = [];

  for (const safeContent of p12.safeContents) {
    for (const safeBag of safeContent.safeBags) {
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        privateKey = safeBag.key as forge.pki.rsa.PrivateKey;
      } else if (safeBag.type === forge.pki.oids.certBag) {
        certificates.push(safeBag.cert as forge.pki.Certificate);
      }
    }
  }

  if (!privateKey) {
    throw new Error("El cert no contiene private key. Está corrupto?");
  }
  if (certificates.length === 0) {
    throw new Error("El cert no contiene ningún certificate.");
  }

  // El cert del titular es el que NO es CA.
  const certificate = certificates.find(
    (c) => !c.extensions.some((e) => e.name === "basicConstraints" && e.cA)
  );
  if (!certificate) {
    throw new Error(
      "No se encontró cert del titular en el .pfx — solo certs de CAs."
    );
  }

  // Extraer el RUT del cert (viene en el subject como "serialNumber" en
  // el formato "12345678-9" ó dentro del CN con prefijo).
  const rutHolder = extractRutFromCert(certificate);

  // Convertir a PEM para libs de firma que esperan PEM, no objetos forge.
  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
  const certificatePem = forge.pki.certificateToPem(certificate);

  cached = { privateKey, certificate, rutHolder, privateKeyPem, certificatePem };
  return cached;
}

function extractRutFromCert(cert: forge.pki.Certificate): string {
  // El SII guarda el RUT en el subject como serialNumber attribute (OID
  // 2.5.4.5). Iteramos por los attributes manualmente porque el shortName
  // de forge no siempre se setea correctamente en certs chilenos.
  for (const attr of cert.subject.attributes) {
    if (attr.type === "2.5.4.5" || attr.name === "serialNumber") {
      const value = String(attr.value);
      if (/^\d{7,9}-[\dkK]$/.test(value)) {
        return value;
      }
    }
  }
  // Fallback: buscar en el CN si el SII lo embebe ahí en algunos casos.
  for (const attr of cert.subject.attributes) {
    if (attr.type === "2.5.4.3" || attr.name === "commonName") {
      const m = String(attr.value).match(/(\d{7,9}-[\dkK])/);
      if (m) return m[1];
    }
  }
  throw new Error("No se pudo extraer el RUT del subject del cert.");
}
