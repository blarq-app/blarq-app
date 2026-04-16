import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";

interface ArtefactoItem {
  room: string;
  name: string;
  brand: string | null;
  quantity: number;
  listPrice: number;
  discountPercent: number | null;
  clientPrice: number;
}

interface PaymentTerm {
  stage: string;
  percentage: number;
}

interface ArtefactosPDFProps {
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
  items: ArtefactoItem[];
  paymentTerms: PaymentTerm[];
}

const ROOMS: Record<string, string> = {
  bano_principal: "Bano Principal",
  bano_secundario: "Bano Secundario",
  bano_visita: "Bano Visita",
  cocina: "Cocina",
  lavadero: "Lavadero",
  otro: "Otro",
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

export default function ArtefactosPDF({
  project,
  budget,
  items,
  paymentTerms,
}: ArtefactosPDFProps) {
  const totalCliente = items.reduce((sum, i) => sum + i.clientPrice, 0);

  const byRoom = Object.entries(ROOMS)
    .map(([key, label]) => ({
      key,
      label,
      items: items.filter((i) => i.room === key),
      subtotal: items
        .filter((i) => i.room === key)
        .reduce((sum, i) => sum + i.clientPrice, 0),
    }))
    .filter((r) => r.items.length > 0);

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
            <Text style={styles.docTitle}>PRESUPUESTO ARTEFACTOS</Text>
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

        {/* Items by room - client-facing */}
        {byRoom.map((room) => (
          <View key={room.key} wrap={false}>
            <Text style={styles.sectionTitle}>{room.label}</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.cellName}>ARTEFACTO</Text>
              <Text style={styles.cellBrand}>MARCA</Text>
              <Text style={styles.cellQtySmall}>CANT.</Text>
              <Text style={styles.cellListPrice}>P. LISTA</Text>
              <Text style={styles.cellDiscount}>DESC.</Text>
              <Text style={styles.cellClientPrice}>PRECIO</Text>
            </View>
            {room.items.map((item, idx) => (
              <View
                key={idx}
                style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={styles.cellName}>{item.name}</Text>
                <Text style={styles.cellBrand}>{item.brand || "-"}</Text>
                <Text style={styles.cellQtySmall}>{item.quantity}</Text>
                <Text style={styles.cellListPrice}>
                  {fmtCLP(item.listPrice)}
                </Text>
                <Text style={styles.cellDiscount}>
                  {item.discountPercent ? `${item.discountPercent}%` : "-"}
                </Text>
                <Text style={styles.cellClientPrice}>
                  {fmtCLP(item.clientPrice)}
                </Text>
              </View>
            ))}
            <View style={styles.chapterRow}>
              <Text style={styles.cellName}>Subtotal {room.label}</Text>
              <Text style={styles.cellBrand}></Text>
              <Text style={styles.cellQtySmall}></Text>
              <Text style={styles.cellListPrice}></Text>
              <Text style={styles.cellDiscount}></Text>
              <Text style={styles.cellClientPrice}>
                {fmtCLP(room.subtotal)}
              </Text>
            </View>
          </View>
        ))}

        {/* Total */}
        <View style={styles.summaryBox}>
          <View style={styles.summaryTotal}>
            <Text style={styles.summaryTotalLabel}>TOTAL</Text>
            <Text style={styles.summaryTotalValue}>
              {fmtCLP(totalCliente)}
            </Text>
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
                  {fmtCLP((totalCliente * term.percentage) / 100)}
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
