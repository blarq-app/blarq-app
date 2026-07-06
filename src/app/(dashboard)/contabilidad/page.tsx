import { redirect } from "next/navigation";

// El módulo de contabilidad abre en el F29 por default.
export default function ContabilidadIndex() {
  redirect("/contabilidad/f29");
}
