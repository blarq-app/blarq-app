import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { StyleSheet } from "@react-pdf/renderer";

export interface ListaCompraRow {
  name: string;
  unit: string;
  qtyNeeded: number;
  qtyBought: number;
  unitPrice: number | null;
  notes: string | null;
  source: "budget" | "manual" | "excess";
}

interface Props {
  projectName: string;
  budgetVersion: string;
  filter: "todo" | "pendiente" | "comprado";
  rows: ListaCompraRow[];
  generatedAt: string;
}

const s = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    borderBottom: "2px solid #1a1a1a",
    paddingBottom: 10,
  },
  logo: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 3,
    marginBottom: 2,
  },
  headerSub: {
    fontSize: 7,
    color: "#888",
  },
  docTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
    textAlign: "right",
  },
  docMeta: {
    fontSize: 7,
    color: "#888",
    textAlign: "right",
  },
  // Summary cards
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  summaryCard: {
    flex: 1,
    border: "0.5px solid #e0e0e0",
    borderRadius: 4,
    padding: "6 10",
    backgroundColor: "#fafafa",
  },
  summaryLabel: { fontSize: 7, color: "#888", marginBottom: 2 },
  summaryValue: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  summaryNote: { fontSize: 6, color: "#aaa", marginTop: 1 },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#1a1a1a",
    color: "#fff",
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    minHeight: 18,
    alignItems: "center",
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "0.5px solid #ebebeb",
    minHeight: 18,
    alignItems: "center",
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottom: "0.5px solid #ebebeb",
    minHeight: 18,
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  tableRowDone: {
    flexDirection: "row",
    borderBottom: "0.5px solid #ebebeb",
    minHeight: 18,
    alignItems: "center",
    backgroundColor: "#f0fdf4",
  },
  // Columns
  cCheck: { width: "4%", padding: "3 4", textAlign: "center" },
  cName:  { width: "28%", padding: "3 5" },
  cUnit:  { width: "6%", padding: "3 4", textAlign: "center" },
  cNec:   { width: "10%", padding: "3 5", textAlign: "right" },
  cComp:  { width: "10%", padding: "3 5", textAlign: "right" },
  cPend:  { width: "10%", padding: "3 5", textAlign: "right", fontFamily: "Helvetica-Bold" },
  cPrice: { width: "13%", padding: "3 5", textAlign: "right" },
  cTotal: { width: "13%", padding: "3 5", textAlign: "right", fontFamily: "Helvetica-Bold" },
  cNotes: { width: "16%", padding: "3 5" },
  // Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: "0.5px solid #ccc",
    paddingTop: 5,
    fontSize: 6,
    color: "#aaa",
  },
});

function fmtNum(n: number) {
  if (Number.isInteger(n)) return n.toLocaleString("es-CL");
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
}

function fmtClp(n: number) {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

const FILTER_LABEL: Record<string, string> = {
  todo: "Todos los materiales",
  pendiente: "Pendientes de compra",
  comprado: "Materiales comprados",
};

export default function ListaCompraPDF({ projectName, budgetVersion, filter, rows, generatedAt }: Props) {
  // Resumen
  const rowsWithPrice = rows.filter((r) => r.unitPrice != null && r.qtyNeeded > 0);
  const totalPpto = rowsWithPrice.reduce((s, r) => s + r.qtyNeeded * r.unitPrice!, 0);
  const totalComprado = rowsWithPrice.reduce((s, r) => s + Math.min(r.qtyBought, r.qtyNeeded) * r.unitPrice!, 0);
  const totalPend = rowsWithPrice.reduce((s, r) => s + Math.max(0, r.qtyNeeded - r.qtyBought) * r.unitPrice!, 0);

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.logo}>BLARQ</Text>
            <Text style={s.headerSub}>Lista de Compra · {projectName}</Text>
          </View>
          <View>
            <Text style={s.docTitle}>Lista de Compra</Text>
            <Text style={s.docMeta}>{FILTER_LABEL[filter] || filter}</Text>
            <Text style={s.docMeta}>Presupuesto: {budgetVersion}</Text>
            <Text style={s.docMeta}>{generatedAt}</Text>
          </View>
        </View>

        {/* Resumen */}
        {rowsWithPrice.length > 0 && (
          <View style={s.summaryRow}>
            <View style={s.summaryCard}>
              <Text style={s.summaryLabel}>Total presupuestado</Text>
              <Text style={s.summaryValue}>{fmtClp(totalPpto)}</Text>
              <Text style={s.summaryNote}>neto s/IVA</Text>
            </View>
            <View style={[s.summaryCard, { backgroundColor: "#f0fdf4", border: "0.5px solid #bbf7d0" }]}>
              <Text style={s.summaryLabel}>Ya comprado</Text>
              <Text style={[s.summaryValue, { color: "#166534" }]}>{fmtClp(totalComprado)}</Text>
              <Text style={s.summaryNote}>neto s/IVA</Text>
            </View>
            <View style={[s.summaryCard, { backgroundColor: "#fff7ed", border: "0.5px solid #fed7aa" }]}>
              <Text style={s.summaryLabel}>Por comprar</Text>
              <Text style={[s.summaryValue, { color: "#c2410c" }]}>{fmtClp(totalPend)}</Text>
              <Text style={s.summaryNote}>neto s/IVA</Text>
            </View>
            <View style={[s.summaryCard, { flex: 0.6 }]}>
              <Text style={s.summaryLabel}>Materiales</Text>
              <Text style={s.summaryValue}>{rows.length}</Text>
              <Text style={s.summaryNote}>{rows.filter(r => r.qtyBought >= r.qtyNeeded && r.qtyNeeded > 0).length} completados</Text>
            </View>
          </View>
        )}

        {/* Tabla */}
        <View>
          <View style={s.tableHeader}>
            <Text style={s.cCheck}>✓</Text>
            <Text style={s.cName}>Material</Text>
            <Text style={s.cUnit}>Und</Text>
            <Text style={s.cNec}>Necesario</Text>
            <Text style={s.cComp}>Comprado</Text>
            <Text style={s.cPend}>Pendiente</Text>
            <Text style={s.cPrice}>P. Unit neto</Text>
            <Text style={s.cTotal}>Total $</Text>
            <Text style={s.cNotes}>Notas / Marca</Text>
          </View>

          {rows.map((row, idx) => {
            const pend = Math.max(0, row.qtyNeeded - row.qtyBought);
            const done = pend <= 0.001 && row.qtyNeeded > 0;
            const rowStyle = done ? s.tableRowDone : idx % 2 === 0 ? s.tableRow : s.tableRowAlt;
            const totalRow = row.unitPrice != null ? row.qtyNeeded * row.unitPrice : null;

            return (
              <View key={idx} style={rowStyle} wrap={false}>
                <Text style={s.cCheck}>{done ? "✓" : "○"}</Text>
                <Text style={s.cName}>{row.name}</Text>
                <Text style={s.cUnit}>{row.unit}</Text>
                <Text style={s.cNec}>{fmtNum(row.qtyNeeded)}</Text>
                <Text style={s.cComp}>{row.qtyBought > 0 ? fmtNum(row.qtyBought) : "—"}</Text>
                <Text style={[s.cPend, { color: pend > 0.001 ? "#c2410c" : "#9ca3af" }]}>
                  {pend > 0.001 ? fmtNum(pend) : "—"}
                </Text>
                <Text style={s.cPrice}>{row.unitPrice != null ? fmtClp(row.unitPrice) : "—"}</Text>
                <Text style={s.cTotal}>{totalRow != null ? fmtClp(totalRow) : "—"}</Text>
                <Text style={s.cNotes}>{row.notes || ""}</Text>
              </View>
            );
          })}
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text>BLARQ · Lista de Compra · {projectName}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
