import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const PROFESSIONAL = "JOSÉ TOMÁS LARRAÍN";

// Shown whenever the budget has no DB payment terms
const DEFAULT_PAYMENT_TERMS = [
  { stage: "Anticipo", percentage: 40 },
  { stage: "Avance",   percentage: 25 },
  { stage: "Avance",   percentage: 25 },
  { stage: "Saldo",    percentage: 10 },
];

const CHAPTERS: Record<string, { label: string; index: number }> = {
  demoliciones:  { label: "DEMOLICIONES",                          index: 1 },
  reparaciones:  { label: "REPARACIONES",                          index: 2 },
  electricas:    { label: "INSTALACIONES ELECTRICAS",              index: 3 },
  sanitarias:    { label: "INSTALACIONES SANITARIAS Y GASFITERIA", index: 4 },
  terminaciones: { label: "TERMINACIONES",                         index: 5 },
  limpieza:      { label: "LIMPIEZA Y ASEO",                       index: 6 },
};

const OBSERVACIONES = [
  "Mandante dejara libre los accesos y las superficies a intervenir, dispondra de suministro electrico y de agua potable, ademas de baño para las personas que trabajen en la obra.",
  "Todo aumento de obra se recargara al costo directo según los precios unitarios más un recargo del mismo porcentaje en GG expresado en la oferta.",
  "No se consideran Permisos Municipales ni de administacion del Condominio dentro de este presupuesto.",
  "Esta cotizacion tiene una validez de 10 dias corridos.",
  "Los pagos se haran con el valor de la UF del dia, y solo se aceptaran pagos por transferencia bancaria o con tarjeta por medio de link de pago, en cuyo caso se agregara la comision de Transbank.",
  "Los valores expresados en la cotizacion podrian variar luego de visitar la propiedad.",
  "Al aprobar la cotizacion se autoriza a la empresa Blarq a publicar contenido en Redes Sociales y pagina web. Fotos, videos del avance y estado de la obra y a la instalacion de publicidad hacia el exterior de la obra (terrazas, balcones, porton).",
  "Una vez aprobado el presupuesto, se solicita pago de anticipo al menos 2 semanas antes del comienzo de la obra.",
];

// ─── Types ──────────────────────────────────────────────────────────────────
interface ObraItem {
  chapter: string;
  itemNumber: string;
  name: string;
  description: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface PaymentTerm {
  stage: string;
  percentage: number;
  amount: number | null;
}

interface ObraPDFProps {
  project: {
    name: string;
    clientName: string;
    clientPhone: string | null;
    clientEmail: string | null;
    address: string | null;
    ufReference: number | null;
  };
  budget: {
    version: string;
    date: string | Date;
    ggPercentage: number | null;
    utilityPercentage: number | null;
    observations: string | null;
  };
  items: ObraItem[];
  paymentTerms: PaymentTerm[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtCLP(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

function fmtQty(n: number): string {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const day   = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year  = String(date.getUTCFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingBottom: 44,
    paddingHorizontal: 38,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#111",
  },

  // ── Header ─────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: "1px solid #ccc",
  },
  headerLeft: { flex: 1 },
  logo: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
    marginBottom: 3,
  },
  logoSub: { fontSize: 7, color: "#888", letterSpacing: 0.5 },
  headerRight: { alignItems: "flex-end" },
  versionLabel: { fontSize: 6.5, color: "#aaa", marginBottom: 1 },
  docTitle: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 5 },
  professionalLabel: { fontSize: 6.5, color: "#aaa", marginBottom: 1 },
  professionalName: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#333" },

  // ── Info grid ──────────────────────────────────────────────────────────
  infoGrid: {
    flexDirection: "row",
    marginBottom: 14,
    gap: 24,
  },
  infoCol: { flex: 1 },
  infoRow: { marginBottom: 5 },
  infoLabel: {
    fontSize: 6,
    color: "#999",
    textTransform: "uppercase" as const,
    marginBottom: 1,
  },
  infoValue: { fontSize: 8, fontFamily: "Helvetica-Bold" },

  // ── Table header ───────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#444",
    color: "#fff",
    fontFamily: "Helvetica-Bold",
    fontSize: 6.5,
    textTransform: "uppercase" as const,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "0.5px solid #e4e4e4",
    minHeight: 17,
    alignItems: "flex-start",
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottom: "0.5px solid #e4e4e4",
    minHeight: 17,
    alignItems: "flex-start",
    backgroundColor: "#f7f7f7",
  },
  chapterRow: {
    flexDirection: "row",
    backgroundColor: "#e6e6e6",
    fontFamily: "Helvetica-Bold",
    minHeight: 17,
    alignItems: "center",
    marginTop: 3,
  },

  // ── Columns — widths must sum to 100% ──────────────────────────────────
  // 5 + 20 + 32 + 7 + 8 + 14 + 14 = 100
  cItem: {
    width: "5%",
    paddingVertical: 4,
    paddingLeft: 2,
    paddingRight: 2,
    textAlign: "center" as const,
  },
  cName: {
    width: "20%",
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 8,   // generous right gap so text never bleeds into DESCRIPCION
  },
  cDesc: {
    width: "32%",
    paddingVertical: 4,
    paddingLeft: 4,    // matches the gap left by cName's paddingRight
    paddingRight: 6,
    color: "#555",
  },
  cUnit: {
    width: "7%",
    paddingVertical: 4,
    paddingLeft: 2,
    paddingRight: 2,
    textAlign: "center" as const,
  },
  cQty: {
    width: "8%",
    paddingVertical: 4,
    paddingLeft: 2,
    paddingRight: 4,
    textAlign: "right" as const,
  },
  cPU: {
    width: "14%",
    paddingVertical: 4,
    paddingLeft: 2,
    paddingRight: 5,
    textAlign: "right" as const,
  },
  cTotal: {
    width: "14%",
    paddingVertical: 4,
    paddingLeft: 2,
    paddingRight: 4,
    textAlign: "right" as const,
    fontFamily: "Helvetica-Bold",
  },

  // ── Summary (right-aligned block) ──────────────────────────────────────
  summaryWrap: {
    marginTop: 16,
    alignSelf: "flex-end",
    width: 252,
  },
  summaryTopLine: {
    borderTop: "1px solid #333",
  },
  summaryRow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottom: "0.5px solid #e8e8e8",
  },
  summaryLabel: { flex: 1, fontSize: 7.5, color: "#333" },
  summaryPct:   { width: 32, fontSize: 7.5, textAlign: "right" as const, paddingRight: 6, color: "#888" },
  summaryVal:   { width: 88, fontSize: 7.5, textAlign: "right" as const },
  summaryTotalRow: {
    flexDirection: "row",
    paddingTop: 5,
    paddingBottom: 3,
    borderTop: "1.5px solid #222",
    marginTop: 2,
  },
  summaryTotalLabel: { flex: 1, fontSize: 10, fontFamily: "Helvetica-Bold" },
  summaryTotalVal:   { width: 120, fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right" as const },

  // ── Formas de pago ─────────────────────────────────────────────────────
  paymentTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 5,
    textDecoration: "underline" as const,
  },
  paymentRow:   { flexDirection: "row", marginBottom: 2.5 },
  paymentStage: { width: 70, fontSize: 7.5, color: "#333" },
  paymentPct:   { fontSize: 7.5, color: "#555" },

  // ── Observations ───────────────────────────────────────────────────────
  obsTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 5,
  },
  obsRow:  { flexDirection: "row", marginBottom: 3.5 },
  obsNum:  { width: 14, fontSize: 7, color: "#777" },
  obsText: { flex: 1, fontSize: 7, color: "#444", lineHeight: 1.4 },

  // ── Footer ─────────────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 18,
    left: 38,
    right: 38,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: "0.5px solid #ccc",
    paddingTop: 5,
    fontSize: 6.5,
    color: "#aaa",
  },
});

// ─── Component ───────────────────────────────────────────────────────────────
export default function ObraPDF({ project, budget, items, paymentTerms }: ObraPDFProps) {
  const ggPct   = budget.ggPercentage   || 0;
  const utilPct = budget.utilityPercentage || 0;

  // Round at every step to prevent floating-point accumulation
  const costoDirecto = Math.round(items.reduce((acc, i) => acc + i.total, 0));
  const gg           = Math.round(costoDirecto * (ggPct / 100));
  const utilidad     = Math.round(costoDirecto * (utilPct / 100));
  const neto         = costoDirecto + gg + utilidad;
  const iva          = Math.round(neto * 0.19);
  const total        = neto + iva;

  const chapters = Object.entries(CHAPTERS)
    .map(([key, ch]) => ({
      key, ...ch,
      items: items.filter((i) => i.chapter === key),
    }))
    .filter((ch) => ch.items.length > 0);

  const dateStr = fmtDate(budget.date);

  // Use DB terms if present, otherwise fall back to standard schedule
  const terms: Array<{ stage: string; percentage: number }> =
    paymentTerms.length > 0 ? paymentTerms : DEFAULT_PAYMENT_TERMS;

  const summaryRows = [
    { label: "COSTO DIRECTO",    pct: "",             val: costoDirecto },
    { label: "GASTOS GENERALES", pct: `${ggPct}%`,   val: gg           },
    { label: "UTILIDADES",       pct: `${utilPct}%`, val: utilidad     },
    { label: "COSTO NETO",       pct: "",             val: neto         },
    { label: "IVA",              pct: "19%",          val: iva          },
  ];

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── HEADER ── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.logo}>BLARQ</Text>
            <Text style={s.logoSub}>BLANCO LARRAÍN ARQUITECTOS</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.versionLabel}>Versión:</Text>
            <Text style={s.docTitle}>{budget.version} COTIZACION OBRA</Text>
            <Text style={s.professionalLabel}>Profesional a cargo:</Text>
            <Text style={s.professionalName}>{PROFESSIONAL}</Text>
          </View>
        </View>

        {/* ── INFO GRID ── */}
        <View style={s.infoGrid}>
          <View style={s.infoCol}>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Mandante</Text>
              <Text style={s.infoValue}>{project.clientName.toUpperCase()}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Proyecto</Text>
              <Text style={s.infoValue}>{project.name.toUpperCase()}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Dirección</Text>
              <Text style={s.infoValue}>{(project.address || "—").toUpperCase()}</Text>
            </View>
          </View>
          <View style={s.infoCol}>
            {project.clientPhone && (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Celular</Text>
                <Text style={s.infoValue}>{project.clientPhone}</Text>
              </View>
            )}
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Fecha</Text>
              <Text style={s.infoValue}>{dateStr}</Text>
            </View>
            {project.ufReference != null && (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Valor UF</Text>
                <Text style={s.infoValue}>{fmtCLP(project.ufReference)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── TABLE HEADER ── */}
        <View style={s.tableHeader}>
          <Text style={s.cItem}>ITEM</Text>
          <Text style={s.cName}>PARTIDA</Text>
          {/* cDesc has color:#555 — override to white in header */}
          <Text style={[s.cDesc, { color: "#fff" }]}>DESCRIPCION</Text>
          <Text style={s.cUnit}>UNID.</Text>
          <Text style={s.cQty}>CANT.</Text>
          <Text style={s.cPU}>P.U</Text>
          <Text style={s.cTotal}>TOTAL</Text>
        </View>

        {/* ── CHAPTERS & ITEMS ── */}
        {chapters.map((chapter) => (
          <View key={chapter.key}>
            <View style={s.chapterRow}>
              <Text style={s.cItem}>{chapter.index}</Text>
              <Text style={[s.cName, { width: "95%" }]}>{chapter.label}</Text>
            </View>

            {chapter.items.map((item, idx) => (
              <View
                key={item.itemNumber}
                style={idx % 2 === 0 ? s.tableRow : s.tableRowAlt}
                wrap={false}
              >
                <Text style={s.cItem}>{item.itemNumber}</Text>
                <Text style={s.cName}>{item.name}</Text>
                <Text style={s.cDesc}>{item.description || ""}</Text>
                <Text style={s.cUnit}>{item.unit}</Text>
                <Text style={s.cQty}>{fmtQty(item.quantity)}</Text>
                <Text style={s.cPU}>{fmtCLP(item.unitPrice)}</Text>
                <Text style={s.cTotal}>{fmtCLP(item.total)}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* ── SUMMARY ── */}
        <View style={s.summaryWrap}>
          {/* Top line above COSTO DIRECTO */}
          <View style={s.summaryTopLine} />
          {summaryRows.map(({ label, pct, val }) => (
            <View key={label} style={s.summaryRow}>
              <Text style={s.summaryLabel}>{label}</Text>
              <Text style={s.summaryPct}>{pct}</Text>
              <Text style={s.summaryVal}>{fmtCLP(val)}</Text>
            </View>
          ))}
          {/* Bottom total row with strong top border */}
          <View style={s.summaryTotalRow}>
            <Text style={s.summaryTotalLabel}>COSTO TOTAL</Text>
            <Text style={s.summaryTotalVal}>{fmtCLP(total)}</Text>
          </View>
        </View>

        {/* ── FORMAS DE PAGO ── */}
        <View>
          <Text style={s.paymentTitle}>Formas de Pago</Text>
          {terms.map((t, i) => (
            <View key={i} style={s.paymentRow}>
              <Text style={s.paymentStage}>{t.stage}</Text>
              <Text style={s.paymentPct}>{t.percentage}%</Text>
            </View>
          ))}
        </View>

        {/* ── OBSERVACIONES GENERALES ── */}
        <View>
          <Text style={s.obsTitle}>OBSERVACIONES GENERALES:</Text>
          {OBSERVACIONES.map((obs, i) => (
            <View key={i} style={s.obsRow}>
              <Text style={s.obsNum}>{i + 1}.</Text>
              <Text style={s.obsText}>{obs}</Text>
            </View>
          ))}
        </View>

        {/* ── FOOTER ── */}
        <View style={s.footer} fixed>
          <Text>BLARQ — BLANCO LARRAÍN ARQUITECTOS</Text>
          <Text>{budget.version} — {dateStr}</Text>
        </View>

      </Page>
    </Document>
  );
}
