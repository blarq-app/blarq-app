import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";

interface ObraItem {
  chapter: string;
  itemNumber: string;
  name: string;
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

const CHAPTERS: Record<string, { label: string; index: number }> = {
  demoliciones: { label: "Demoliciones", index: 1 },
  reparaciones: { label: "Reparaciones", index: 2 },
  electricas: { label: "Eléctricas", index: 3 },
  sanitarias: { label: "Sanitarias", index: 4 },
  terminaciones: { label: "Terminaciones", index: 5 },
  limpieza: { label: "Limpieza", index: 6 },
};

function fmtCLP(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function ObraPDF({
  project,
  budget,
  items,
  paymentTerms,
}: ObraPDFProps) {
  const ggPct = budget.ggPercentage || 0;
  const utilPct = budget.utilityPercentage || 0;

  const costoDirecto = items.reduce((sum, i) => sum + i.total, 0);
  const gg = costoDirecto * (ggPct / 100);
  const subtotal = costoDirecto + gg;
  const utilidad = subtotal * (utilPct / 100);
  const neto = subtotal + utilidad;
  const iva = neto * 0.19;
  const totalConIva = neto + iva;

  // Group by chapter
  const chapters = Object.entries(CHAPTERS)
    .map(([key, ch]) => ({
      key,
      ...ch,
      items: items.filter((i) => i.chapter === key),
      subtotal: items
        .filter((i) => i.chapter === key)
        .reduce((sum, i) => sum + i.total, 0),
    }))
    .filter((ch) => ch.items.length > 0);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.logo}>BLARQ</Text>
            <Text style={styles.subtitle}>Constructora</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docTitle}>PRESUPUESTO OBRA</Text>
            <Text style={styles.docVersion}>
              {budget.version} — {fmtDate(budget.date)}
            </Text>
          </View>
        </View>

        {/* Client Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Proyecto</Text>
            <Text style={styles.infoValue}>{project.name}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Cliente</Text>
            <Text style={styles.infoValue}>{project.clientName}</Text>
          </View>
          {project.address && (
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Direccion</Text>
              <Text style={styles.infoValue}>{project.address}</Text>
            </View>
          )}
        </View>

        {/* Table header */}
        <View style={styles.tableHeader}>
          <Text style={styles.cellNum}>N°</Text>
          <Text style={styles.cellName}>PARTIDA</Text>
          <Text style={styles.cellUnit}>UNIDAD</Text>
          <Text style={styles.cellQty}>CANT.</Text>
          <Text style={styles.cellPrice}>P. UNITARIO</Text>
          <Text style={styles.cellTotal}>TOTAL</Text>
        </View>

        {/* Chapters and items */}
        {chapters.map((chapter) => (
          <View key={chapter.key} style={styles.table} wrap={false}>
            {/* Chapter header */}
            <View style={styles.chapterRow}>
              <Text style={styles.cellNum}>{chapter.index}</Text>
              <Text style={styles.cellName}>{chapter.label}</Text>
              <Text style={styles.cellUnit}></Text>
              <Text style={styles.cellQty}></Text>
              <Text style={styles.cellPrice}></Text>
              <Text style={styles.cellTotal}>{fmtCLP(chapter.subtotal)}</Text>
            </View>
            {/* Items */}
            {chapter.items.map((item, idx) => (
              <View
                key={item.itemNumber}
                style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={styles.cellNum}>{item.itemNumber}</Text>
                <Text style={styles.cellName}>{item.name}</Text>
                <Text style={styles.cellUnit}>{item.unit}</Text>
                <Text style={styles.cellQty}>{item.quantity}</Text>
                <Text style={styles.cellPrice}>{fmtCLP(item.unitPrice)}</Text>
                <Text style={styles.cellTotal}>{fmtCLP(item.total)}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* Summary */}
        <View style={styles.summaryBox}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Costo Directo</Text>
            <Text style={styles.summaryValue}>{fmtCLP(costoDirecto)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              Gastos Generales ({ggPct}%)
            </Text>
            <Text style={styles.summaryValue}>{fmtCLP(gg)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Utilidad ({utilPct}%)</Text>
            <Text style={styles.summaryValue}>{fmtCLP(utilidad)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Neto</Text>
            <Text style={styles.summaryValue}>{fmtCLP(neto)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>IVA (19%)</Text>
            <Text style={styles.summaryValue}>{fmtCLP(iva)}</Text>
          </View>
          <View style={styles.summaryTotal}>
            <Text style={styles.summaryTotalLabel}>TOTAL</Text>
            <Text style={styles.summaryTotalValue}>{fmtCLP(totalConIva)}</Text>
          </View>
        </View>

        {/* Payment Terms */}
        {paymentTerms.length > 0 && (
          <View style={styles.paymentTable}>
            <Text style={styles.sectionTitle}>FORMA DE PAGO</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.paymentStage}>ETAPA</Text>
              <Text style={styles.paymentPct}>%</Text>
              <Text style={styles.paymentAmount}>MONTO</Text>
            </View>
            {paymentTerms.map((term, idx) => (
              <View key={idx} style={styles.paymentRow}>
                <Text style={styles.paymentStage}>{term.stage}</Text>
                <Text style={styles.paymentPct}>{term.percentage}%</Text>
                <Text style={styles.paymentAmount}>
                  {fmtCLP((totalConIva * term.percentage) / 100)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Observations */}
        {budget.observations && (
          <View style={styles.observationsBox}>
            <Text style={styles.sectionTitle}>OBSERVACIONES Y CONDICIONES</Text>
            <Text style={styles.observationsText}>{budget.observations}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>BLARQ Constructora</Text>
          <Text>
            {budget.version} — {fmtDate(budget.date)}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
