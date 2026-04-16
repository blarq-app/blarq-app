import { StyleSheet } from "@react-pdf/renderer";

export const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    borderBottom: "2px solid #1a1a1a",
    paddingBottom: 12,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    alignItems: "flex-end",
  },
  logo: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 3,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 8,
    color: "#666",
  },
  docTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  docVersion: {
    fontSize: 10,
    color: "#666",
  },
  // Client info
  infoSection: {
    flexDirection: "row",
    marginBottom: 16,
    gap: 40,
  },
  infoBlock: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 7,
    color: "#999",
    textTransform: "uppercase" as const,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  // Section title
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: "#f5f5f5",
    padding: "6 10",
  },
  // Table
  table: {
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#1a1a1a",
    color: "#fff",
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase" as const,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "0.5px solid #e5e5e5",
    minHeight: 20,
    alignItems: "center",
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottom: "0.5px solid #e5e5e5",
    minHeight: 20,
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  // Cells
  cellNum: { width: "8%", padding: "4 6", textAlign: "center" },
  cellName: { width: "32%", padding: "4 6" },
  cellUnit: { width: "10%", padding: "4 6", textAlign: "center" },
  cellQty: { width: "12%", padding: "4 6", textAlign: "right" },
  cellPrice: { width: "18%", padding: "4 6", textAlign: "right" },
  cellTotal: { width: "20%", padding: "4 6", textAlign: "right", fontFamily: "Helvetica-Bold" },
  // Chapter header
  chapterRow: {
    flexDirection: "row",
    backgroundColor: "#e8e8e8",
    fontFamily: "Helvetica-Bold",
    minHeight: 22,
    alignItems: "center",
  },
  // Summary
  summaryBox: {
    marginTop: 16,
    marginLeft: "auto",
    width: 280,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  summaryLabel: {
    fontSize: 9,
    color: "#555",
  },
  summaryValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  summaryTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderTop: "2px solid #1a1a1a",
    marginTop: 4,
  },
  summaryTotalLabel: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
  },
  summaryTotalValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
  },
  // Payment terms
  paymentTable: {
    marginTop: 16,
  },
  paymentRow: {
    flexDirection: "row",
    borderBottom: "0.5px solid #e5e5e5",
    minHeight: 20,
    alignItems: "center",
  },
  paymentStage: { width: "50%", padding: "4 6" },
  paymentPct: { width: "20%", padding: "4 6", textAlign: "center" },
  paymentAmount: { width: "30%", padding: "4 6", textAlign: "right", fontFamily: "Helvetica-Bold" },
  // Observations
  observationsBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#fafafa",
    border: "0.5px solid #e5e5e5",
  },
  observationsText: {
    fontSize: 8,
    lineHeight: 1.5,
    color: "#444",
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: "0.5px solid #ccc",
    paddingTop: 6,
    fontSize: 7,
    color: "#999",
  },
  // Muebles specific
  cellDesc: { width: "40%", padding: "4 6" },
  cellSubcat: { width: "15%", padding: "4 6" },
  cellPriceIva: { width: "25%", padding: "4 6", textAlign: "right", fontFamily: "Helvetica-Bold" },
  // Artefactos specific
  cellRoom: { width: "18%", padding: "4 6" },
  cellBrand: { width: "12%", padding: "4 6" },
  cellQtySmall: { width: "8%", padding: "4 6", textAlign: "center" },
  cellListPrice: { width: "15%", padding: "4 6", textAlign: "right" },
  cellDiscount: { width: "10%", padding: "4 6", textAlign: "center" },
  cellClientPrice: { width: "17%", padding: "4 6", textAlign: "right", fontFamily: "Helvetica-Bold" },
});
