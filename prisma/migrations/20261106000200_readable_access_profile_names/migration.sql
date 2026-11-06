BEGIN;

-- Preserve profile identity, grants and user scopes. Only the exact untouched
-- generated labels from the composable-profile migration are eligible.
-- Block competing profile-name writes while choosing collision-free labels.
LOCK TABLE "TenantAccessRole" IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE profile record; label text; suffix integer;
BEGIN
 FOR profile IN
  SELECT id,"tenantId" FROM "TenantAccessRole"
  WHERE id='account_access_109_'||md5("tenantId")
   AND name='Account access '||substr(md5("tenantId"),1,12)
   AND "nameKey"=lower('Account access '||substr(md5("tenantId"),1,12))
  ORDER BY "tenantId",id
 LOOP
  label:='Existing business access'; suffix:=1;
  WHILE EXISTS(SELECT 1 FROM "TenantAccessRole" WHERE "tenantId"=profile."tenantId" AND "nameKey"=lower(label) AND id<>profile.id) LOOP
   suffix:=suffix+1; label:='Existing business access ('||suffix||')';
  END LOOP;
  UPDATE "TenantAccessRole" SET name=label,"nameKey"=lower(label),version=version+1,"updatedAt"=CURRENT_TIMESTAMP
   WHERE "tenantId"=profile."tenantId" AND id=profile.id;
 END LOOP;
END $$;

COMMIT;
