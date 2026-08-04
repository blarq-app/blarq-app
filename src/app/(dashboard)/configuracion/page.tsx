import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ConfiguracionHub from "@/components/configuracion/ConfiguracionHub";

export const dynamic = "force-dynamic";

/**
 * Hub de Configuración.
 *
 * Hasta ahora no existía: las dos pantallas de ajustes (Reembolsadores y
 * Auditoría de precios) colgaban sueltas al final del menú lateral, y "Mi
 * cuenta" estaba escondida detrás del nombre de usuario en el header — en el
 * celular ese nombre queda apretado contra "Salir" y es casi imposible de
 * acertar. Acá se juntan todas, más las dos pantallas de reglas que viven
 * dentro de Facturas y Banco (se linkean, no se mudan: siguen accesibles desde
 * su sección de origen).
 *
 * Los contadores salen de la base para que la pantalla diga algo antes de
 * entrar. La auditoría de precios no lleva contador a propósito: calcularlo
 * implica recorrer todos los presupuestos borrador comparándolos contra el
 * catálogo, y no se justifica pagar eso cada vez que se abre este menú.
 */
export default async function ConfiguracionPage() {
  const session = await auth();

  const [reembolsadores, reglasFacturas, reglasBanco] = await Promise.all([
    prisma.reembolsador.count(),
    prisma.invoiceCategorizationRule.count(),
    prisma.bankCategorizationRule.count(),
  ]);

  return (
    <ConfiguracionHub
      nombreUsuario={session?.user?.name ?? undefined}
      reembolsadores={reembolsadores}
      reglasFacturas={reglasFacturas}
      reglasBanco={reglasBanco}
    />
  );
}
