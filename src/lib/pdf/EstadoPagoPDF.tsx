import React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";

interface EPItem {
  chapter: string;
  itemNumber: string;
  name: string;
  unit: string;
  quantity: number;
  laborUnitPrice: number;
  laborTotal: number;
  pctAccumulated: number;
  obraItemId: string;
}

interface EstadoPagoPDFProps {
  project: {
    name: string;
    clientName: string;
    address: string | null;
    maestro: { name: string; rut: string | null } | null;
  };
  ep: {
    number: number;
    date: string | Date;
    notes: string | null;
  };
  items: EPItem[];
  prevPaidAccum: Record<string, number>;
  variant: "interno" | "maestro";
}

const CHAPTERS: Record<string, { label: string; index: number }> = {
  demoliciones: { label: "Demoliciones", index: 1 },
  reparaciones: { label: "Reparaciones", index: 2 },
  electricas: { label: "Instalaciones Eléctricas", index: 3 },
  sanitarias: { label: "Instalaciones Sanitarias", index: 4 },
  terminaciones: { label: "Terminaciones", index: 5 },
  limpieza: { label: "Limpieza y Aseo", index: 6 },
};

function clp(n: number) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function EstadoPagoPDF({
  project,
  ep,
  items,
  prevPaidAccum,
  variant,
}: EstadoPagoPDFProps) {
  const showPrices = variant === "interno";

  const grouped: Record<string, EPItem[]> = {};
  items.forEach((i) => {
    grouped[i.chapter] = grouped[i.chapter] || [];
    grouped[i.chapter].push(i);
  });
  const ordered = Object.keys(CHAPTERS).filter((c) => grouped[c]?.length);

  const totals = items.reduce(
    (acc, i) => {
      const a = (i.laborTotal * i.pctAccumulated) / 100;
      const p = (i.laborTotal * (prevPaidAccum[i.obraItemId] || 0)) / 100;
      acc.budget += i.laborTotal;
      acc.accum += a;
      acc.thisEp += a - p;
      return acc;
    },
    { budget: 0, accum: 0, thisEp: 0 }
  );

  const d = new Date(ep.date);
  const dateStr = d.toLocaleDateString("es-CL");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.logo}>BLARQ</Text>
            <Text style={styles.subtitle}>Gestión de Obras</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docTitle}>
              Estado de Pago #{ep.number}
              {variant === "maestro" ? " — Avance" : ""}
            </Text>
            <Text style={styles.docVersion}>{dateStr}</Text>
          </View>
        </View>

        {/* Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Proyecto</Text>
            <Text style={styles.infoValue}>{project.name}</Text>
            {project.address && (
              <Text style={styles.subtitle}>{project.address}</Text>
            )}
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Maestro</Text>
            <Text style={styles.infoValue}>
              {project.maestro?.name || "—"}
            </Text>
            {project.maestro?.rut && (
              <Text style={styles.subtitle}>{project.maestro.rut}</Text>
            )}
          </View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.cellNum}>Ítem</Text>
            <Text style={{ ...styles.cellName, width: showPrices ? "28%" : "50%" }}>
              Partida
            </Text>
            <Text style={styles.cellUnit}>Un</Text>
            <Text style={styles.cellQty}>Cant.</Text>
            {showPrices && (
              <>
                <Text style={{ ...styles.cellPrice, width: "14%" }}>P.U MO</Text>
                <Text style={{ ...styles.cellPrice, width: "14%" }}>Total MO</Text>
              </>
            )}
            <Text
              style={{
                ...styles.cellUnit,
                width: showPrices ? "6%" : "12%",
              }}
            >
              % Av.
            </Text>
            {showPrices && (
              <Text style={{ ...styles.cellTotal, width: "10%" }}>A pagar</Text>
            )}
          </View>

          {ordered.map((chapter) => (
            <React.Fragment key={chapter}>
              <View style={styles.chapterRow}>
                <Text style={{ padding: "4 6" }}>
                  {CHAPTERS[chapter].index}. {CHAPTERS[chapter].label.toUpperCase()}
                </Text>
              </View>
              {grouped[chapter].map((i, idx) => {
                const accum = (i.laborTotal * i.pctAccumulated) / 100;
                const prev = (i.laborTotal * (prevPaidAccum[i.obraItemId] || 0)) / 100;
                const thisEp = accum - prev;
                return (
                  <View
                    key={`${i.itemNumber}-${idx}`}
                    style={idx % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
                  >
                    <Text style={styles.cellNum}>{i.itemNumber}</Text>
                    <Text style={{ ...styles.cellName, width: showPrices ? "28%" : "50%" }}>
                      {i.name}
                    </Text>
                    <Text style={styles.cellUnit}>{i.unit}</Text>
                    <Text style={styles.cellQty}>{i.quantity}</Text>
                    {showPrices && (
                      <>
                        <Text style={{ ...styles.cellPrice, width: "14%" }}>
                          {clp(i.laborUnitPrice)}
                        </Text>
                        <Text style={{ ...styles.cellPrice, width: "14%" }}>
                          {clp(i.laborTotal)}
                        </Text>
                      </>
                    )}
                    <Text
                      style={{
                        ...styles.cellUnit,
                        width: showPrices ? "6%" : "12%",
                      }}
                    >
                      {i.pctAccumulated}%
                    </Text>
                    {showPrices && (
                      <Text style={{ ...styles.cellTotal, width: "10%" }}>
                        {clp(thisEp)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </React.Fragment>
          ))}
        </View>

        {/* Summary */}
        {showPrices && (
          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>MO Presupuestada</Text>
              <Text style={styles.summaryValue}>{clp(totals.budget)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Acumulado total</Text>
              <Text style={styles.summaryValue}>{clp(totals.accum)}</Text>
            </View>
            <View style={styles.summaryTotal}>
              <Text style={styles.summaryTotalLabel}>A pagar este EP</Text>
              <Text style={styles.summaryTotalValue}>{clp(totals.thisEp)}</Text>
            </View>
          </View>
        )}

        {ep.notes && (
          <View style={styles.observationsBox}>
            <Text style={styles.observationsText}>{ep.notes}</Text>
          </View>
        )}

        {/* Firmas (solo maestro) */}
        {variant === "maestro" && (
          <View style={{ flexDirection: "row", marginTop: 40, gap: 40 }}>
            <View style={{ flex: 1, borderTop: "0.5px solid #999", paddingTop: 6 }}>
              <Text style={{ fontSize: 8, color: "#666" }}>Maestro</Text>
            </View>
            <View style={{ flex: 1, borderTop: "0.5px solid #999", paddingTop: 6 }}>
              <Text style={{ fontSize: 8, color: "#666" }}>BLARQ</Text>
            </View>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>BLARQ Constructora</Text>
          <Text>
            EP #{ep.number} · {dateStr}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
