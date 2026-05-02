-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "accessPresetId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_accessPresetId_fkey" FOREIGN KEY ("accessPresetId") REFERENCES "AccessPreset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "replacedByTokenId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccessModule" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccessPreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AccessPresetPermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "presetId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccessPresetPermission_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "AccessPreset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccessPresetPermission_moduleKey_fkey" FOREIGN KEY ("moduleKey") REFERENCES "AccessModule" ("key") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserModulePermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserModulePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserModulePermission_moduleKey_fkey" FOREIGN KEY ("moduleKey") REFERENCES "AccessModule" ("key") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrashItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "deletedById" TEXT,
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrashItem_moduleKey_fkey" FOREIGN KEY ("moduleKey") REFERENCES "AccessModule" ("key") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Origin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Indicator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docNumber" TEXT,
    "contact" TEXT,
    "email" TEXT,
    "percentSetup" INTEGER NOT NULL,
    "bank" TEXT,
    "agency" TEXT,
    "account" TEXT,
    "pixKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company" TEXT NOT NULL,
    "cnpj" TEXT,
    "contact" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL,
    "valueInCents" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" TEXT,
    "isLite" BOOLEAN NOT NULL DEFAULT false,
    "wonAt" DATETIME,
    "lostAt" DATETIME,
    "notes" TEXT,
    "sellerId" TEXT,
    "sdrId" TEXT,
    "originId" TEXT,
    "indicatorId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_sdrId_fkey" FOREIGN KEY ("sdrId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Origin" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "Indicator" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IndicatorPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "indicatorId" TEXT,
    "indicatorNameSnapshot" TEXT NOT NULL,
    "leadCompanySnapshot" TEXT NOT NULL,
    "amountInCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dueDate" DATETIME,
    "paidAt" DATETIME,
    "notes" TEXT,
    "paidByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IndicatorPayment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IndicatorPayment_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "Indicator" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IndicatorPayment_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinanceFlowSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referenceDate" DATETIME,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caixaJson" TEXT,
    "expensesJson" TEXT NOT NULL DEFAULT '[]',
    "revenuesJson" TEXT NOT NULL DEFAULT '[]',
    "overdueJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LeadTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeadTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadComment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadCatalogItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "setupInCents" INTEGER NOT NULL DEFAULT 0,
    "recurringInCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeadCatalogItem_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadCatalogItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "leadId" TEXT,
    "company" TEXT NOT NULL,
    "cnpj" TEXT,
    "contact" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "instance" TEXT,
    "plan" TEXT,
    "paymentMethod" TEXT,
    "installment" TEXT,
    "type" TEXT NOT NULL DEFAULT 'novo',
    "status" TEXT NOT NULL,
    "csStatus" TEXT,
    "notes" TEXT,
    "cancelReason" TEXT,
    "setupInCents" INTEGER NOT NULL DEFAULT 0,
    "recurringInCents" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "technicalAssigneeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "canceledAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "Ticket_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ticket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Ticket_technicalAssigneeId_fkey" FOREIGN KEY ("technicalAssigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TicketTask_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DevSprint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DevTicket" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "proto" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "devType" TEXT NOT NULL,
    "devStatus" TEXT NOT NULL,
    "complexity" TEXT NOT NULL DEFAULT 'Media',
    "score" INTEGER NOT NULL DEFAULT 0,
    "totalPts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT,
    "sprintId" TEXT,
    "parentId" INTEGER,
    "clientName" TEXT,
    "protoExt" TEXT,
    "instance" TEXT,
    "cnpj" TEXT,
    "clientPhone" TEXT,
    "description" TEXT NOT NULL,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "criteriaJson" TEXT NOT NULL DEFAULT '{}',
    "historyJson" TEXT NOT NULL DEFAULT '[]',
    "incident" BOOLEAN NOT NULL DEFAULT false,
    "compliment" BOOLEAN NOT NULL DEFAULT false,
    "docDone" BOOLEAN NOT NULL DEFAULT false,
    "prodBug" BOOLEAN NOT NULL DEFAULT false,
    "reopened" BOOLEAN NOT NULL DEFAULT false,
    "criticalBug" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startDate" DATETIME,
    "deadline" DATETIME,
    "resolvedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DevTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DevTicket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DevTicket_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "DevSprint" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DevTicket_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DevTicket" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DevTicketComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" INTEGER NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DevTicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "DevTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DevTicketComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE INDEX "User_sector_isActive_idx" ON "User"("sector", "isActive");

-- CreateIndex
CREATE INDEX "User_accessPresetId_idx" ON "User"("accessPresetId");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RefreshToken_family_idx" ON "RefreshToken"("family");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AccessModule_active_sortOrder_idx" ON "AccessModule"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AccessPreset_slug_key" ON "AccessPreset"("slug");

-- CreateIndex
CREATE INDEX "AccessPreset_role_isSystem_idx" ON "AccessPreset"("role", "isSystem");

-- CreateIndex
CREATE INDEX "AccessPreset_createdAt_idx" ON "AccessPreset"("createdAt");

-- CreateIndex
CREATE INDEX "AccessPresetPermission_moduleKey_accessLevel_idx" ON "AccessPresetPermission"("moduleKey", "accessLevel");

-- CreateIndex
CREATE UNIQUE INDEX "AccessPresetPermission_presetId_moduleKey_key" ON "AccessPresetPermission"("presetId", "moduleKey");

-- CreateIndex
CREATE INDEX "UserModulePermission_moduleKey_accessLevel_idx" ON "UserModulePermission"("moduleKey", "accessLevel");

-- CreateIndex
CREATE UNIQUE INDEX "UserModulePermission_userId_moduleKey_key" ON "UserModulePermission"("userId", "moduleKey");

-- CreateIndex
CREATE INDEX "TrashItem_moduleKey_deletedAt_idx" ON "TrashItem"("moduleKey", "deletedAt");

-- CreateIndex
CREATE INDEX "TrashItem_entityType_entityId_idx" ON "TrashItem"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "TrashItem_deletedById_deletedAt_idx" ON "TrashItem"("deletedById", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_slug_key" ON "CatalogItem"("slug");

-- CreateIndex
CREATE INDEX "CatalogItem_type_active_idx" ON "CatalogItem"("type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_type_name_key" ON "CatalogItem"("type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Tag_active_createdAt_idx" ON "Tag"("active", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Origin_name_key" ON "Origin"("name");

-- CreateIndex
CREATE INDEX "Origin_active_createdAt_idx" ON "Origin"("active", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Indicator_docNumber_key" ON "Indicator"("docNumber");

-- CreateIndex
CREATE INDEX "Indicator_active_createdAt_idx" ON "Indicator"("active", "createdAt");

-- CreateIndex
CREATE INDEX "Indicator_name_idx" ON "Indicator"("name");

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_sellerId_status_idx" ON "Lead"("sellerId", "status");

-- CreateIndex
CREATE INDEX "Lead_sdrId_status_idx" ON "Lead"("sdrId", "status");

-- CreateIndex
CREATE INDEX "Lead_originId_createdAt_idx" ON "Lead"("originId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_createdById_createdAt_idx" ON "Lead"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_company_idx" ON "Lead"("company");

-- CreateIndex
CREATE INDEX "Lead_cnpj_idx" ON "Lead"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "IndicatorPayment_leadId_key" ON "IndicatorPayment"("leadId");

-- CreateIndex
CREATE INDEX "IndicatorPayment_status_dueDate_idx" ON "IndicatorPayment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "IndicatorPayment_indicatorId_status_idx" ON "IndicatorPayment"("indicatorId", "status");

-- CreateIndex
CREATE INDEX "IndicatorPayment_paidByUserId_paidAt_idx" ON "IndicatorPayment"("paidByUserId", "paidAt");

-- CreateIndex
CREATE INDEX "FinanceFlowSnapshot_importedAt_idx" ON "FinanceFlowSnapshot"("importedAt");

-- CreateIndex
CREATE INDEX "FinanceFlowSnapshot_createdAt_idx" ON "FinanceFlowSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "LeadTask_leadId_done_dueDate_idx" ON "LeadTask"("leadId", "done", "dueDate");

-- CreateIndex
CREATE INDEX "LeadTask_type_done_idx" ON "LeadTask"("type", "done");

-- CreateIndex
CREATE INDEX "LeadComment_leadId_createdAt_idx" ON "LeadComment"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadComment_authorUserId_createdAt_idx" ON "LeadComment"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadCatalogItem_catalogItemId_idx" ON "LeadCatalogItem"("catalogItemId");

-- CreateIndex
CREATE INDEX "LeadCatalogItem_leadId_enabled_idx" ON "LeadCatalogItem"("leadId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCatalogItem_leadId_catalogItemId_key" ON "LeadCatalogItem"("leadId", "catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_code_key" ON "Ticket"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_leadId_key" ON "Ticket"("leadId");

-- CreateIndex
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_assigneeId_status_idx" ON "Ticket"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Ticket_technicalAssigneeId_status_idx" ON "Ticket"("technicalAssigneeId", "status");

-- CreateIndex
CREATE INDEX "Ticket_type_status_idx" ON "Ticket"("type", "status");

-- CreateIndex
CREATE INDEX "Ticket_company_idx" ON "Ticket"("company");

-- CreateIndex
CREATE INDEX "TicketTask_ticketId_done_dueDate_idx" ON "TicketTask"("ticketId", "done", "dueDate");

-- CreateIndex
CREATE INDEX "TicketTask_assigneeId_done_idx" ON "TicketTask"("assigneeId", "done");

-- CreateIndex
CREATE INDEX "TicketComment_ticketId_createdAt_idx" ON "TicketComment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketComment_authorUserId_createdAt_idx" ON "TicketComment"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DevSprint_closed_startDate_idx" ON "DevSprint"("closed", "startDate");

-- CreateIndex
CREATE INDEX "DevSprint_createdAt_idx" ON "DevSprint"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DevTicket_proto_key" ON "DevTicket"("proto");

-- CreateIndex
CREATE INDEX "DevTicket_devStatus_createdAt_idx" ON "DevTicket"("devStatus", "createdAt");

-- CreateIndex
CREATE INDEX "DevTicket_devType_devStatus_idx" ON "DevTicket"("devType", "devStatus");

-- CreateIndex
CREATE INDEX "DevTicket_assigneeId_devStatus_idx" ON "DevTicket"("assigneeId", "devStatus");

-- CreateIndex
CREATE INDEX "DevTicket_sprintId_devStatus_idx" ON "DevTicket"("sprintId", "devStatus");

-- CreateIndex
CREATE INDEX "DevTicket_resolvedAt_idx" ON "DevTicket"("resolvedAt");

-- CreateIndex
CREATE INDEX "DevTicketComment_ticketId_createdAt_idx" ON "DevTicketComment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "DevTicketComment_authorUserId_createdAt_idx" ON "DevTicketComment"("authorUserId", "createdAt");

