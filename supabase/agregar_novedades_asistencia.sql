-- CharryComunica: estados y novedades de asistencia.
-- Puede ejecutarlo aunque el intento anterior haya mostrado un error.

-- El campo estado usa este tipo enumerado en la base de datos.
alter type public.estado_asistencia add value if not exists 'no_asiste';

alter table public.asistencias
  add column if not exists novedad text;

-- Sustituye el control anterior del campo estado para permitir "no_asiste".
do $$
declare
  nombre_restriccion text;
begin
  for nombre_restriccion in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'asistencias'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%estado%'
  loop
    execute format('alter table public.asistencias drop constraint if exists %I', nombre_restriccion);
  end loop;
end $$;

alter table public.asistencias
  add constraint asistencias_estado_check
  check (estado in ('presente', 'no_asiste', 'tarde', 'evasion'));

alter table public.asistencias
  drop constraint if exists asistencias_novedad_check;

alter table public.asistencias
  add constraint asistencias_novedad_check
  check (novedad is null or novedad in ('excusa_medica', 'excusa_personal', 'pendiente_justificar'));
