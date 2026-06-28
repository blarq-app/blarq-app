// Indicadores económicos del mes (UF y UTM) traídos de internet.
//
// Fuente: mindicador.cl (API pública del Banco Central, sin credenciales).
// MJ eligió que la UF/UTM entren automáticamente: la pantalla las trae sola y
// las guarda en IndicadorMensual. Los otros dos indicadores (topes de
// gratificación y de salud) cambian ~una vez al año y se editan a mano.
//
// Qué valor se usa:
//   - UF: el del ÚLTIMO día del mes. La liquidación de sueldo convierte el plan
//     de Isapre (en UF) con la UF del cierre de mes. Validado: mayo 2026 usa
//     40.610,69 = UF del 2026-05-31. Si el mes aún no cierra, se toma el último
//     valor disponible.
//   - UTM: la UTM es un único valor por mes; mindicador.cl la entrega con fecha
//     del día 1.

type SerieItem = { fecha: string; valor: number };

async function fetchSerieAnual(
  indicador: "uf" | "utm",
  year: number
): Promise<SerieItem[]> {
  const res = await fetch(`https://mindicador.cl/api/${indicador}/${year}`, {
    // Estos valores no cambian para un mes ya cerrado; el server los puede
    // cachear un día sin problema.
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!res.ok) {
    throw new Error(
      `mindicador.cl respondió ${res.status} para ${indicador}/${year}`
    );
  }
  const json = (await res.json()) as { serie?: SerieItem[] };
  return json.serie ?? [];
}

export type IndicadoresFetch = { uf: number; utm: number };

// Trae UF (último día del mes) y UTM (valor mensual) para year/month.
// Lanza si la API no responde o no hay datos para ese mes.
export async function fetchIndicadoresMes(
  year: number,
  month: number
): Promise<IndicadoresFetch> {
  const prefijo = `${year}-${String(month).padStart(2, "0")}`;

  const [serieUf, serieUtm] = await Promise.all([
    fetchSerieAnual("uf", year),
    fetchSerieAnual("utm", year),
  ]);

  // UF del mes, ordenada por fecha ascendente; nos quedamos con la última
  // (último día disponible del mes).
  const ufMes = serieUf
    .filter((d) => d.fecha.startsWith(prefijo))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const utmMes = serieUtm.filter((d) => d.fecha.startsWith(prefijo));

  if (ufMes.length === 0) {
    throw new Error(`mindicador.cl no tiene UF para ${prefijo}`);
  }
  if (utmMes.length === 0) {
    throw new Error(`mindicador.cl no tiene UTM para ${prefijo}`);
  }

  return {
    uf: ufMes[ufMes.length - 1].valor,
    utm: utmMes[0].valor,
  };
}
