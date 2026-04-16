-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "clientEmail" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'cotizacion',
    "startDate" DATETIME,
    "estimatedEndDate" DATETIME,
    "actualEndDate" DATETIME,
    "currentVersion" TEXT NOT NULL DEFAULT 'V1',
    "ufReference" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BudgetVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'borrador',
    "type" TEXT NOT NULL,
    "observations" TEXT,
    "ggPercentage" REAL DEFAULT 20,
    "utilityPercentage" REAL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BudgetVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObraItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "budgetVersionId" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "unitPrice" REAL NOT NULL,
    "total" REAL NOT NULL,
    "costMaterial" REAL,
    "costLabor" REAL,
    "costSubcontract" REAL,
    "costMargin" REAL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ObraItem_budgetVersionId_fkey" FOREIGN KEY ("budgetVersionId") REFERENCES "BudgetVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MuebleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "budgetVersionId" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "costDistributor" REAL NOT NULL,
    "utilityPercentage" REAL NOT NULL,
    "clientPrice" REAL NOT NULL,
    "clientPriceIva" REAL NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MuebleItem_budgetVersionId_fkey" FOREIGN KEY ("budgetVersionId") REFERENCES "BudgetVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArtefactoItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "budgetVersionId" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "brand" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "listPrice" REAL NOT NULL,
    "discountPercent" REAL,
    "clientPrice" REAL NOT NULL,
    "realCostBlarq" REAL,
    "referenceLink" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ArtefactoItem_budgetVersionId_fkey" FOREIGN KEY ("budgetVersionId") REFERENCES "BudgetVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentTerm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "budgetVersionId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "percentage" REAL NOT NULL,
    "amount" REAL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PaymentTerm_budgetVersionId_fkey" FOREIGN KEY ("budgetVersionId") REFERENCES "BudgetVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'directo',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CostCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CostCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "categoryId" TEXT,
    "type" TEXT NOT NULL,
    "folioNumber" TEXT,
    "rutIssuer" TEXT,
    "businessName" TEXT,
    "issueDate" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "netAmount" REAL NOT NULL,
    "iva" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CostCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "type" TEXT NOT NULL,
    "invoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sin_asignar',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "BudgetVersion_projectId_idx" ON "BudgetVersion"("projectId");

-- CreateIndex
CREATE INDEX "ObraItem_budgetVersionId_idx" ON "ObraItem"("budgetVersionId");

-- CreateIndex
CREATE INDEX "MuebleItem_budgetVersionId_idx" ON "MuebleItem"("budgetVersionId");

-- CreateIndex
CREATE INDEX "ArtefactoItem_budgetVersionId_idx" ON "ArtefactoItem"("budgetVersionId");

-- CreateIndex
CREATE INDEX "PaymentTerm_budgetVersionId_idx" ON "PaymentTerm"("budgetVersionId");

-- CreateIndex
CREATE INDEX "CostCategory_parentId_idx" ON "CostCategory"("parentId");

-- CreateIndex
CREATE INDEX "Invoice_projectId_idx" ON "Invoice"("projectId");

-- CreateIndex
CREATE INDEX "Invoice_categoryId_idx" ON "Invoice"("categoryId");

-- CreateIndex
CREATE INDEX "BankMovement_invoiceId_idx" ON "BankMovement"("invoiceId");
