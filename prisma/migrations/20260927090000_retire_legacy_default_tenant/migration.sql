BEGIN;

-- Historical migrations remain immutable. Fresh installs finish without their
-- old single-business placeholder; existing installs must not lose linked data.
SET LOCAL app.rls_bypass = 'on';
DO $$
DECLARE
  related_table RECORD;
  has_records BOOLEAN;
BEGIN
  PERFORM id FROM "Tenant"
    WHERE id = 'tenant_default' AND slug = 'default' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  FOR related_table IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenantId'
    ORDER BY table_name
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE "tenantId" = $1)', related_table.table_name)
      INTO has_records USING 'tenant_default';
    IF has_records THEN
      RAISE EXCEPTION 'Legacy default tenant still has records in %. Review and clear or reassign them before retiring it.', related_table.table_name;
    END IF;
  END LOOP;

  DELETE FROM "Tenant" WHERE id = 'tenant_default' AND slug = 'default';
END $$;

COMMIT;
