# REVIEW — Conciliaciones de Maxxa pendientes de traer a la app (2026)

Listado accionable para revisar **caso por caso** qué conciliaciones de Maxxa traer a la app. **Sin bulk-import, sin automatización — solo visibilidad.** Solo lectura: no se tocó código ni datos.

- **Fecha**: 2026-05-30. **Fuente app**: dump read-only `backups/audit-facturas-conciliacion-2026-05-30T23-32.json`. **Fuente Maxxa**: 2 exports de facturas + 2 cartolas (Operativa, todo 2026), en `~/Downloads`.
- **Cruce factura↔mov**: por glosa/remitente cuando hay colisión de monto (la lección del reporte anterior).

## Reconciliación de los números que cité antes

El "55 facturas / $147M" del reporte anterior (hallazgo #2) **mezclaba gasto con cobro**. De-mezclado:

| | Facturas/Movs | Monto | Va en |
|---|--:|--:|---|
| Recibidas (gasto) Maxxa pagada / app pendiente | 44 facturas | $18.276.697 | **Sección 1** |
| Emitidas (cobro) Maxxa pagada / app pendiente | 11 facturas | $128.739.585 | **Sección 2** |
| Movimientos de cobro sin asignar en app | 27 movs distintos | $111.957.207 | **Sección 2** |

El "80 / $136M" (hallazgo #4) estaba inflado por doble-matching; el número limpio de **movimientos de cobro distintos** es **27 ($111,96M)** — pagan las 11 emitidas en 30 imputaciones (2 movimientos pagan varias facturas: Inmobiliaria $8,9M paga 3, un Fernando Terre $5M paga 2).

---

# SECCIÓN 1 — Recibidas que Maxxa marca pagadas y la app deja pendientes

**44 facturas de proveedor, $18.276.697.** Maxxa las tiene con saldo $0; la app las muestra `pendiente` (la app no vinculó el pago al banco). Ordenadas por monto.

**Antes de leer la tabla, 3 cosas**:
- **Los movimientos suelen cubrir varias facturas** (una compra Sodimac de $468.488 paga 2 facturas del mismo día). Por eso a veces el monto del pago es mayor al de la factura.
- **3 filas (marcadas ⚠S4) son en realidad los cruces de tarjeta de la Sección 4**: la app pegó ese movimiento a OTRA factura, por eso la correcta quedó pendiente. **No agregar pago — resolver en Sección 4** (desligar + reimputar).
- **Reembolsadores**: "Transf a Cristóbal" / "Transf a Elias" pagando facturas Sodimac/Paula son pagos vía reembolsador (la app los maneja por alias). Normal, verificar el alias.

| Folio | tipoDoc | Proveedor (RUT) | Proyecto | Monto | Emisión | Movimiento(s) Maxxa | Nota |
|---|--|---|---|--:|--|---|---|
| F-1610 | 33 | MTW SpA (77359368-K) | Fco. de Aguirre | $7.556.805 | 25-02 | 11-03 $6.556.805 + 10-03 $1.000.000 "Transf a MTW Spa" | suma calza |
| F-568 | 33 | TERMOPLUS (77329614-6) | Casa Arrau | $3.041.670 | 12-03 | 13-03 $2.041.670 + 18-02 $1.000.000 "Transf a Termoplus" | abono parcial previo a emisión (normal) |
| F-1491032 | 33 | COMERCIAL K (77137860-9) | JNC-Vitacura | $1.887.977 | 27-04 | 13-04 $2.429.083 "Transf a Comercial K" | mov cubre varias K |
| F-599 | 33 | TERMOPLUS (77329614-6) | JNC-Vitacura | $1.807.276 | 20-05 | 29-05 $1.807.276 "Transf a Termoplus" | calza exacto |
| F-1476170 | 33 | COMERCIAL K (77137860-9) | Cocina Farellones | $470.854 | 23-03 | 17-03 $551.890 "Transf a Comercial K" | mov cubre F-1476170 + F-1476172 |
| F-241197 | 33 | STUDIO GROUP (76927160-0) | Cocina Farellones | $445.842 | 18-03 | 10-03 $614.516 "Transf a Studio Group" | mov mayor (¿cubre otra?) |
| F-145412525 | 33 | SODIMAC (96792430-K) | Portofino | $345.706 | 11-02 | 11-02 $468.488 "Compra SODIMAC" | mov cubre F-145412525 + F-145412526 |
| F-145591736 | 33 | SODIMAC (96792430-K) | Portofino | $329.304 | 23-02 | 23-02 $466.626 "Transf a Cristóbal" | **reembolsador Cristóbal**; cubre F-145591735 también |
| F-58 | 33 | VIDRIOS ROTOS (78006028-K) | Fco. de Aguirre | $275.001 | 23-02 | 09-02 $275.000 "Transf a VIDRIOS ROTOS" | calza ($1 redondeo); pago previo a emisión |
| F-145362305 | 33 | SODIMAC (96792430-K) | Cocina Farellones | $231.039 | 09-02 | 10-02 $261.075 "Compra SODIMAC" | mov mayor |
| F-1890 | 33 | PAULA JOHANNA (12270678-8) | Portofino | $226.100 | 22-05 | 25-05 $226.100 "Transf a Elias ARIAS" | **reembolsador Elias** |
| F-71 | 33 | CLEAN UP (78200906-0) | Portofino | $182.070 | 20-05 | 20-05 $182.070 "Transf a CLEAN UP" | calza exacto |
| F-147323366 | 33 | SODIMAC (96792430-K) | (sin proyecto) | $140.485 | 28-05 | 29-05 $140.485 "Compra SODIMAC" | calza; falta proyecto en app |
| F-145591735 | 33 | SODIMAC (96792430-K) | Cocina Farellones | $132.403 | 23-02 | 23-02 $466.626 "Transf a Cristóbal" | **reembolsador**; mismo mov que F-145591736 |
| F-145412526 | 33 | SODIMAC (96792430-K) | Cocina Farellones | $122.782 | 11-02 | 11-02 $468.488 "Compra SODIMAC" | mismo mov que F-145412525 |
| F-147323367 | 33 | SODIMAC (96792430-K) | (sin proyecto) | $110.645 | 28-05 | 29-05 $110.645 "Compra SODIMAC" | calza; falta proyecto |
| F-3231 | 34 | EXTERNALIZA (77693206-K) | BLARQ | $107.265 | 23-12-25 | 06-01 $214.303 "Transf a Externaliza" | **frontera dic-2025**; mov mayor |
| F-3004528 | 33 | SHERWIN (96803460-K) | Portofino | $83.088 | 18-05 | 18-05 $83.088 "Compra VESPUCIO ORIENTE" | Vespucio Oriente = tienda Sherwin |
| F-1476172 | 33 | COMERCIAL K (77137860-9) | Cocina Farellones | $81.035 | 23-03 | 17-03 $551.890 "Transf a Comercial K" | mismo mov que F-1476170 |
| F-147553607 | 33 | SODIMAC (96792430-K) | (sin proyecto) | $74.731 | 29-05 | 29-05 $74.731 "Compra SODIMAC" | calza; falta proyecto |
| F-1488550 | 33 | COMERCIAL K (77137860-9) | Portofino | $65.865 | 22-04 | 14-04 $89.474 "Transf a Comercial K" | mov cubre F-1488550 + F-1487813 |
| F-2988549 | 34 | VESPUCIO ORIENTE (76376061-8) | BLARQ | $59.502 | 14-02 | 27-02 $59.502 "PAC VESPUCIO OR" | **⚠S4** (app lo pegó a Esmax) |
| F-3289476 | 34 | VESPUCIO ORIENTE (76376061-8) | BLARQ | $59.486 | 12-05 | 28-05 $59.486 "PAC VESPUCIO OR" | calza exacto |
| F-147330902 | 33 | SODIMAC (96792430-K) | (sin proyecto) | $46.765 | 18-05 | 18-05 $46.765 "Compra SODIMAC" | calza; falta proyecto |
| F-6046499 | 33 | COSTANERA NORTE (76496130-7) | BLARQ | $46.509 | 13-01 | 09-02 $96.801 "PAGO EN LINEA SERVIPAG" | mov cubre 2 autopistas (Costanera + Autopista Central) |
| F-88607 | 33 | MAXXA SOFTWARE (76770943-9) | BLARQ | $43.115 | 10-05 | 28-05 $43.115 "Compra ERPYME" | calza |
| F-3004529 | 33 | SHERWIN (96803460-K) | JNC-Vitacura | $34.748 | 18-05 | 18-05 $34.748 "Compra VESPUCIO ORIENTE" | Vespucio = Sherwin |
| F-147553606 | 33 | SODIMAC (96792430-K) | (sin proyecto) | $26.299 | 29-05 | 29-05 $26.299 "Compra SODIMAC" | calza; falta proyecto |
| F-38153 | 33 | MAXI MOBILITY/Cabify (76237019-0) | BLARQ | $25.878 | 01-01 | **(no aparece en la cartola)** | ⚠ pago en Sueldos o fuera de feb-may — no verificable acá |
| F-106843 | 33 | GARACHENA (96702950-5) | (sin proyecto) | $25.870 | 14-05 | 14-05 $25.870 "Compra FERRETERIA GARACH" | **⚠S4** (app lo pegó a Santander) |
| F-53531550 | 33 | ENTEL (96806980-2) | BLARQ | $24.980 | 05-05 | 26-05 $24.980 "PAC Entel Pcs" | calza |
| F-1487813 | 33 | COMERCIAL K (77137860-9) | Portofino | $23.608 | 20-04 | 14-04 $89.474 "Transf a Comercial K" | mismo mov que F-1488550 |
| F-12360403 | 33 | MERCADOLIBRE (77398220-1) | Cocina Farellones | $22.083 | 26-02 | 26-02 $60.935 "Compra MERCADOPAGO" | mov cubre varias ML del día |
| F-19150678 | 34 | AUTOPISTA CENTRAL (96945440-8) | BLARQ | $21.191 | 13-01 | 09-02 $96.801 "PAGO EN LINEA SERVIPAG" | mismo mov que Costanera |
| F-2963377 | 33 | SHERWIN (96803460-K) | Fco. de Aguirre | $18.683 | 06-03 | 06-03 $18.683 "Compra VESPUCIO ORIENTE" | **⚠S4** (app lo pegó a Jorgelin) |
| F-22715920 | 33 | CONSTRUMART (96511460-2) | (sin proyecto) | $15.990 | 18-05 | 18-05 $15.990 "Compra CONSTRU-MART" | calza |
| F-147134679 | 33 | SODIMAC (96792430-K) | JNC-Vitacura | $12.807 | 14-05 | 14-05 $12.807 "Compra SODIMAC" | calza |
| F-10001280 | 34 | VESPUCIO NORTE (76166816-1) | BLARQ | $10.952 | 06-04 | 21-04 $10.960 "PAC Vespucio No" | calza ($8 redondeo) |
| F-15463 | 33 | TECNOLOGIA ZK (77603022-8) | Portofino | $9.958 | 02-03 | 26-02 $60.935 "Compra MERCADOPAGO" | mov MercadoPago compartido |
| F-147256929 | 33 | SODIMAC (96792430-K) | (sin proyecto) | $9.890 | 18-05 | 18-05 $9.890 "Compra SODIMAC" | calza |
| F-12098934 | 33 | MERCADOLIBRE (77398220-1) | BLARQ | $8.670 | 04-02 | 05-02 $28.940 "Compra MERCADOPAGO" | mov ML compartido |
| F-12360404 | 33 | MERCADOLIBRE (77398220-1) | Fco. de Aguirre | $4.990 | 26-02 | 26-02 $60.935 "Compra MERCADOPAGO" | mov ML compartido |
| F-12098944 | 33 | MERCADOLIBRE (77398220-1) | BLARQ | $4.290 | 04-02 | 05-02 $28.940 "Compra MERCADOPAGO" | mov ML compartido |
| F-12098945 | 33 | MERCADOLIBRE (77398220-1) | BLARQ | $2.490 | 04-02 | 05-02 $28.940 "Compra MERCADOPAGO" | mov ML compartido |

**Lo que conviene mirar primero**: las grandes (MTW $7,5M, Termoplus $3M, Comercial K $1,9M) — son transferencias claras a proveedores con la glosa que calza. Las chicas son casi todas compras con tarjeta Sodimac/MercadoPago donde **un movimiento paga varias facturas** (split). La única no verificable acá es Maxi Mobility F-38153 (Maxxa no muestra el movimiento).

---

# SECCIÓN 2 — Cobros sin asignar en la app que Maxxa atribuye a una factura emitida

**27 movimientos de cobro distintos, $111.957.207**, que pagan **11 facturas emitidas** (en 30 imputaciones — 2 movimientos pagan varias facturas). La app tiene el movimiento `sin_asignar`/`sin_factura` y la factura `pendiente` (o `pagada` por la regla "emitida ≈ cobrada", pero sin el vínculo bancario). Ordenados por monto.

**Contexto que NO es riesgo** (BLARQ paga primero, factura después): cobro anterior a la emisión es normal. "Maria Carolina/Ovalle" = persona del cliente **Agrícola Ovalle** (Portofino). Las marco como contexto, no alarma.

| Mov fecha | Monto | Glosa banco | Emitida (Maxxa) | Cliente | Monto factura | Proyecto | Nota / riesgo |
|---|--:|---|---|---|--:|---|---|
| 19-03 | $10.000.000 | Depósito Documento Otros Bancos | F-161 | Fernando Terre | $31.741.260 | Cocina Farellones | **depósito sin nombre — confirmar** |
| 04-03 | $10.000.000 | Depósito en Efectivo | F-161 | Fernando Terre | $31.741.260 | Cocina Farellones | **depósito efectivo — confirmar** |
| 13-01 | $8.945.552 | 76215867-1 transferencia INMOBILIA | F-140/141/142 | Inmobiliaria Los Saldos | $437k/$7,0M/$1,5M | Cerro San Luis | 1 mov paga 3 facturas (split); glosa calza |
| 13-03 | $6.240.000 | Depósito en Efectivo | F-161 | Fernando Terre | $31.741.260 | Cocina Farellones | **depósito efectivo — confirmar** |
| 16-02 | $5.000.000 | 0105112904 Transf. Maria Carolina | F-158 | Agrícola Ovalle | $18.737.105 | Portofino | persona Ovalle = cliente |
| 13-02 | $5.000.000 | 0105112904 Transf. Maria Carolina | F-158 | Agrícola Ovalle | $18.737.105 | Portofino | persona Ovalle = cliente |
| 26-01 | $5.000.000 | 0062846402 Transf de FERNANDO ANDR | F-149 | Fernando Terre | $19.350.000 | Cocina Farellones | glosa calza |
| 21-01 | $5.000.000 | 0062846402 Transf de FERNANDO ANDR | F-149 | Fernando Terre | $19.350.000 | Cocina Farellones | glosa calza |
| 21-01 | $5.000.000 | 0062846402 Transf de FERNANDO ANDR | F-148 | Fernando Terre | $10.250.000 | Cocina Farellones | glosa calza |
| 20-01 | $5.000.000 | 0062846402 Transf de FERNANDO ANDR | F-148 | Fernando Terre | $10.250.000 | Cocina Farellones | glosa calza |
| 06-04 | $5.000.000 | 0105112904 Transf. Maria Ovalle Al | F-164 | Agrícola Ovalle | $13.529.261 | Portofino | persona Ovalle = cliente |
| 17-03 | $5.000.000 | 0105112904 Transf. Maria Carolina | F-159 | Agrícola Ovalle | $18.339.253 | Portofino | persona Ovalle = cliente |
| 16-03 | $5.000.000 | 0105112904 Transf. MARIA CAROLINA | F-159 | Agrícola Ovalle | $18.339.253 | Portofino | persona Ovalle = cliente |
| 03-03 | $5.000.000 | 0062846402 Transf de FERNANDO ANDR | F-161 | Fernando Terre | $31.741.260 | Cocina Farellones | glosa calza |
| 16-02 | $4.741.353 | 0785995503 Transf. ASESORA E INMOB | F-157 | Distribución y Marketing | $5.241.353 | Vitacura 81 | glosa = "Asesora e Inmob" ≠ cliente — **verificar** |
| 26-01 | $4.500.000 | 0062846402 Transf de FERNANDO ANDR | F-149 | Fernando Terre | $19.350.000 | Cocina Farellones | glosa calza |
| 19-01 | $4.000.000 | 0062846402 Transf de FERNANDO ANDR | F-149 | Fernando Terre | $19.350.000 | Cocina Farellones | glosa calza |
| 18-02 | $3.887.622 | 0094960185 Transf. Maria Pia Garce | F-151 | Maria Pia Garces | $8.887.622 | Casa Arrau | glosa calza; **app ya marcó la factura pagada** (sin vínculo) |
| 18-03 | $3.339.253 | 0105112904 Transf. MARIA CAROLINA | F-159 | Agrícola Ovalle | $18.339.253 | Portofino | persona Ovalle = cliente |
| 02-04 | $2.800.000 | 0105112904 Transf. Maria Carolina | F-164 | Agrícola Ovalle | $13.529.261 | Portofino | persona Ovalle = cliente |
| 05-01 | $2.185.801 | 0092189120 Transf de MAURICIO ENRI | F-139 | Distribución y Marketing | $2.605.801 | Vitacura 81 | glosa = "Mauricio Enri" ≠ cliente — **verificar** |
| 04-03 | $2.176.244 | 0105112904 Transf. Maria Carolina | F-158 | Agrícola Ovalle | $18.737.105 | Portofino | persona Ovalle = cliente |
| 16-02 | $1.310.860 | 0105112904 Transf. Maria Carolina | F-158 | Agrícola Ovalle | $18.737.105 | Portofino | persona Ovalle = cliente |
| 26-01 | $850.000 | 0062846402 Transf de FERNANDO ANDR | F-149 | Fernando Terre | $19.350.000 | Cocina Farellones | glosa calza |
| 08-04 | $729.261 | 0105112904 Transf. Maria Carolina | F-164 | Agrícola Ovalle | $13.529.261 | Portofino | persona Ovalle = cliente |
| 10-03 | $501.261 | 0062846402 Transf de FERNANDO ANDR | F-161 | Fernando Terre | $31.741.260 | Cocina Farellones | glosa calza |
| 12-02 | $500.000 | 0785995503 Transf. ASESORA E INMOB | F-157 | Distribución y Marketing | $5.241.353 | Vitacura 81 | glosa = "Asesora e Inmob" — **verificar** |
| 11-02 | $250.000 | 0105112904 Transf. Maria Carolina | F-158 | Agrícola Ovalle | $18.737.105 | Portofino | persona Ovalle = cliente |

(La tabla muestra 28 filas porque el movimiento de Inmobiliaria —1 mov que paga 3 facturas— va en una sola fila. Total real: 27 movimientos distintos.)

**Resumen por cliente (cobro que la app no tiene vinculado)**:

| Cliente (emitida) | Proyecto | Movimientos | Total cobrado en banco |
|---|---|--:|--:|
| Fernando Terre (F-148/149/161) | Cocina Farellones | 11 | ~$56.000.000 |
| Agrícola Ovalle (F-158/159/164) | Portofino | 11 | ~$50.600.000 |
| Inmobiliaria Los Saldos (F-140/141/142) | Cerro San Luis | 1 | $8.945.552 |
| Distribución y Marketing (F-139/157) | Vitacura 81 | 3 | ~$7.400.000 |
| Maria Pia Garces (F-151) | Casa Arrau | 1 | $3.887.622 |

**Watch real**: (1) los **2 depósitos en efectivo/documento de $10M + $6,24M** atribuidos a Fernando Terre no tienen nombre en la glosa — Maxxa los infirió; confirmá que son de Cocina Farellones. (2) Distribución y Marketing F-139/F-157 los pagan glosas "Mauricio Enri" / "Asesora e Inmob" — confirmá que esa persona/entidad es ese cliente (Vitacura 81).

---

# SECCIÓN 3 — Casos donde NO seguir a Maxxa (la app está mejor)

Maxxa imputó estas transferencias a Daniel a un proveedor (**Brune SpA F-433**) que no corresponde. La glosa dice "Transf a Daniel" y la app las trata bien como **pago sin respaldo a Daniel** (maestro informal). **No traer estas conciliaciones de Maxxa.**

| Fecha | Monto | Glosa banco | Maxxa dice (ignorar) | App dice (correcto) |
|---|--:|---|---|---|
| 2026-02-23 | $1.500.000 | 0137279045 Transf a Daniel | BRUNE SPA F-433 | DANIEL IGNACIO sin respaldo F-5 |
| 2026-02-09 | $1.000.000 | 0137279045 Transf a Daniel | BRUNE SPA F-433 | DANIEL IGNACIO sin respaldo F-210073 |
| 2026-02-09 | $600.000 | 0137279045 Transf a Daniel | BRUNE SPA F-433 | DANIEL IGNACIO sin respaldo F-2500736362 |

(Nota: Brune SpA F-433 en Maxxa quedó "pagada" con plata que en realidad fue a Daniel. Es un error de Maxxa, no de la app.)

---

# SECCIÓN 4 — Cruces de tarjeta: requieren DESLIGAR y reimputar

Estos 3 son distintos de las secciones anteriores: la app **ya tiene el movimiento imputado, pero a la factura equivocada** (bug del auto-match por monto sin RUT en compras con tarjeta). Para arreglarlos hay que **quitar la imputación actual y crear la correcta** — no basta con agregar un pago.

| Fecha | Monto | Glosa banco | App imputó a (QUITAR) | Debería ser (Maxxa) | Estado mov app |
|---|--:|---|---|---|---|
| 2026-03-06 | $18.683 | Compra VESPUCIO ORIENTE | JORGELIN GABRIELA MOLERO F-1299 | SHERWIN WILLIAMS F-2963377 | conciliado |
| 2026-02-27 | $59.502 | PAC VESPUCIO OR | ESMAX RED F-8586058 | VESPUCIO ORIENTE F-2988549 | conciliado |
| 2026-05-14 | $25.870 | Compra FERRETERIA GARACHENA | Santander-Chile F-55158835 | FERRETERIA GARACHENA F-106843 | conciliado |

**Pasos por caso** (para cuando decidas): (1) desligar el `InvoicePayment` actual → la factura equivocada vuelve a pendiente y el movimiento queda libre; (2) imputar el movimiento a la factura correcta (que hoy figura en la Sección 1 como pendiente: F-2963377, F-2988549, F-106843). Las 3 facturas correctas **ya existen en la app**.

> Nota: hay 2 casos más de "Compra VESPUCIO ORIENTE" pagando Sherwin (F-3004528 $83.088, F-3004529 $34.748, en Sección 1) que probablemente sean el mismo patrón. Habría que ver si el movimiento Vespucio quedó imputado a otra factura o solo sin asignar — revisá esos dos al limpiar este grupo.

---

# Cómo usar este reporte

- **Secciones 1 y 2**: candidatas a **agregar la imputación** en la app (vincular el movimiento a la factura). Visibilidad total — revisá cada una. Empezá por las grandes y por las marcadas "verificar".
- **Sección 3**: **no tocar** — la app ya está bien, Maxxa está mal.
- **Sección 4**: **desligar + reimputar** (3 casos chicos, pero son los únicos donde la app tiene plata en la factura equivocada).

**No toqué nada.** Quedo esperando tu lectura antes de cualquier acción.
