// Registra el webhook del bot de Telegram apuntando a la app desplegada.
//
// Correr UNA vez después de desplegar (o cuando cambie la URL):
//   npx tsx scripts/telegram-set-webhook.ts https://blarq-app.vercel.app
//
// Telegram empieza a mandar los mensajes del bot a:
//   <url>/api/telegram/webhook
//
// Si TELEGRAM_WEBHOOK_SECRET está en el entorno, se registra como secret
// token: Telegram lo manda en cada request y el webhook lo valida, para que
// nadie más pueda postear updates falsos a la URL.

import "dotenv/config";
import { setWebhook } from "../src/lib/telegram/api";

async function main() {
  const base = process.argv[2];
  if (!base) {
    console.error(
      "Uso: npx tsx scripts/telegram-set-webhook.ts <url-base>\n" +
        "Ej:  npx tsx scripts/telegram-set-webhook.ts https://blarq-app.vercel.app"
    );
    process.exit(1);
  }
  const url = `${base.replace(/\/$/, "")}/api/telegram/webhook`;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || undefined;
  const res = await setWebhook(url, secret);
  console.log("setWebhook ->", JSON.stringify(res, null, 2));
  console.log("\nWebhook apuntando a:", url);
  if (!secret) {
    console.log(
      "\nAVISO: no hay TELEGRAM_WEBHOOK_SECRET configurado. Recomendado " +
        "agregarlo (cadena random) en .env y en Vercel para validar el origen."
    );
  }
}

main();
