import { auth } from "@/lib/auth";

// requireSession — portero único de las rutas /api.
//
// POR QUÉ ACÁ Y NO EN UN middleware/proxy: el control que de verdad protege
// un endpoint debe correr DENTRO del handler, no en una capa separada de
// adelante. El CVE-2025-29927 (marzo 2025) mostró que el middleware de Next
// se puede saltar por completo mandando un header interno trucado
// (`x-middleware-subrequest`). Acá no hay capa que saltar: el handler siempre
// se ejecuta para responder, y esta es su primera línea.
//
// REGLA "NEGAR POR DEFECTO": todo endpoint bajo /api debe llamar a esta
// función salvo los de la allowlist (auth de NextAuth + webhook de Telegram).
// El guardián `scripts/check-api-auth.mjs` corre en el build de Vercel y
// hace fallar el deploy si aparece un endpoint nuevo sin este chequeo.
//
// USO en cada handler protegido:
//
//   export async function POST(request: NextRequest) {
//     const gate = await requireSession();
//     if (gate instanceof Response) return gate;   // 401, corta acá
//     // ...resto del handler; si se necesita el usuario: gate.user
//   }
//
// Devuelve la sesión válida, o una Response 401 lista para retornar. Se usa
// `Response` (global del runtime, sin import) para que los handlers no tengan
// que importar NextResponse solo por esto.
export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "No autenticado" }, { status: 401 });
  }
  return session;
}
