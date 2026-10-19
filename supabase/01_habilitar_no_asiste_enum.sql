-- PASO 1: ejecute esta única sentencia en una consulta independiente.
-- Espere a que Supabase indique "Success" antes de ejecutar el archivo siguiente.
alter type public.estado_asistencia add value if not exists 'no_asiste';
