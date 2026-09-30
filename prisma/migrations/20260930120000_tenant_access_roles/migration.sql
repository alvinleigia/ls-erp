BEGIN;
CREATE TABLE "TenantAccessRole" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "nameKey" TEXT NOT NULL,
 "permissions" TEXT[] NOT NULL,
 "archived" BOOLEAN NOT NULL DEFAULT false,
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "TenantRoleAssignment" (
 "tenantId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "roleId" TEXT NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "TenantRoleAssignment_pkey" PRIMARY KEY ("tenantId", "userId")
);
CREATE UNIQUE INDEX "TenantAccessRole_tenantId_id_key" ON "TenantAccessRole"("tenantId","id");
CREATE UNIQUE INDEX "TenantAccessRole_tenantId_nameKey_key" ON "TenantAccessRole"("tenantId","nameKey");
CREATE INDEX "TenantAccessRole_tenantId_archived_name_id_idx" ON "TenantAccessRole"("tenantId","archived","name","id");
CREATE INDEX "TenantRoleAssignment_tenantId_roleId_idx" ON "TenantRoleAssignment"("tenantId","roleId");
ALTER TABLE "TenantAccessRole" ADD CONSTRAINT "TenantAccessRole_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantRoleAssignment" ADD CONSTRAINT "TenantRoleAssignment_tenantId_userId_fkey" FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId","id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantRoleAssignment" ADD CONSTRAINT "TenantRoleAssignment_tenantId_roleId_fkey" FOREIGN KEY ("tenantId","roleId") REFERENCES "TenantAccessRole"("tenantId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Match the existing tenant RLS contract.
ALTER TABLE "TenantAccessRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantAccessRole" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantAccessRole" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "TenantRoleAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantRoleAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantRoleAssignment" USING (app.tenant_match("tenantId")) WITH CHECK (app.tenant_match("tenantId"));
ALTER TABLE "TenantAccessRole" ADD CONSTRAINT "TenantAccessRole_valid" CHECK (version > 0 AND char_length(name) BETWEEN 2 AND 80);
COMMIT;
