import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";

interface MuebleItem {
  subcategory: string;
  description: string;
  clientPriceIva: number;
}

interface PaymentTerm {
  stage: string;
  percentage: number;
}

interface MueblesPDFProps {
  project: {
    name: string;
    clientName: string;
    address: string | null;
  };
  budget: {
    version: string;
    date: string | Date;
    observations: string | null;
  };
  items: MuebleItem[];
  paymentTerms: PaymentTerm[];
}

const SUBCATEGORIES: Record<string, string> = {
  mueble: "Muebles",
  cubierta: "Cubiertas",
  herraje: "Herrajes",
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

export default function MueblesPDF({
  project,
  budget,
  items,
  paymentTerms,
}: MueblesPDFProps) {
  const totalIva = items.reduce((sum, i) => sum + i.clientPriceIva, 0);

  const grouped = Object.entries(SUBCATEGORIES)
    .map(([key, label]) => ({
      key,
      label,
      items: items.filter((i) => i.subcategory === key),
      subtotal: items
        .filter((i) => i.subcategory === key)
        .reduce((sum, i) => sum + i.clientPriceIva, 0),
    }))
    .filter((g) => g.items.length > 0);

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
            <Text style={styles.docTitle}>PRESUPUESTO MUEBLES</Text>
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
        </View>

        {/* Items by subcategory - client-facing (no cost info) */}
        {grouped.map((group) => (
          <View key={group.key} wrap={false}>
            <Text style={styles.sectionTitle}>{group.label}</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.cellDesc}>DESCRIPCION</Text>
              <Text style={styles.cellPriceIva}>PRECIO IVA INCLUIDO</Text>
            </View>
            {group.items.map((item, idx) => (
              <View
                key={idx}
                style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={styles.cellDesc}>{item.description}</Text>
                <Text style={styles.cellPriceIva}>
                  {fmtCLP(item.clientPriceIva)}
                </Text>
              </View>
            ))}
            <View style={styles.chapterRow}>
              <Text style={styles.cellDesc}>Subtotal {group.label}</Text>
              <Text style={styles.cellPriceIva}>
                {fmtCLP(group.subtotal)}
              </Text>
            </View>
          </View>
        ))}

        {/* Total */}
        <View style={styles.summaryBox}>
          <View style={styles.summaryTotal}>
            <Text style={styles.summaryTotalLabel}>TOTAL IVA INCLUIDO</Text>
            <Text style={styles.summaryTotalValue}>{fmtCLP(totalIva)}</Text>
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
                  {fmtCLP((totalIva * term.percentage) / 100)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Observations */}
        {budget.observations && (
          <View style={styles.observationsBox}>
            <Text style={styles.sectionTitle}>OBSERVACIONES</Text>
            <Text style={styles.observationsText}>{budget.observations}</Text>
          </View>
        )}

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
