-- Permiso mínimo para que la Edge Function crear-docentes pueda
-- leer los docentes pendientes. No da acceso al navegador ni a docentes.
grant usage on schema public to service_role;
grant select on table public.docentes to service_role;
