BEGIN;
-- Derivation runs as this protected trigger's owner. A hosted migration owner
-- need not be a superuser: retain its INSERT grant while application callers
-- keep SELECT-only access to the ancestry index. Never grant PUBLIC writes.
DO $$
DECLARE writer name;
BEGIN
 SELECT pg_get_userbyid(p.proowner) INTO writer
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='app' AND p.proname='project_hierarchy_links'
   AND p.prosecdef AND p.pronargs=0;
 IF writer IS NULL THEN RAISE EXCEPTION 'Protected project hierarchy writer is missing'; END IF;
 EXECUTE format('GRANT INSERT ON public."RealEstateProjectAncestor" TO %I',writer);
END $$;
COMMIT;
