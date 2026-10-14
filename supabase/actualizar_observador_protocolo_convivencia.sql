-- CharryComunica - Ajuste del Observador al Manual de Convivencia 2026-2027.
-- Ejecute este archivo UNA vez en Supabase > SQL Editor, después de crear_modulo_observador.sql.
-- Tipo II y Tipo III no generan avisos automáticos a acudientes: los gestiona la instancia institucional responsable.

alter table public.observaciones
  add column if not exists clasificacion text not null default 'seguimiento'
    check (clasificacion in ('seguimiento','tipo_i','tipo_ii','tipo_iii')),
  add column if not exists remision_a text not null default 'aula'
    check (remision_a in ('aula','coordinacion_academica','coordinacion_convivencia','orientacion_escolar','rectoria_comite','ruta_externa'));

-- La clasificación institucional determina el manejo de comunicaciones delicadas.
create or replace function public.preparar_notificaciones_observacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hay_aviso boolean := false;
  avisos_correo integer := 0;
begin
  -- Situaciones Tipo II y III requieren gestión de Coordinación/Rectoría; no se notifican automáticamente.
  if not new.notificar_acudiente or new.clasificacion in ('tipo_ii', 'tipo_iii') then
    return new;
  end if;

  insert into public.observaciones_notificaciones (observacion_id, acudiente_id, canal, destino)
  select new.id, a.id, 'correo', a.correo
  from public.estudiantes_acudientes ea
  join public.acudientes a on a.id = ea.acudiente_id
  where ea.estudiante_id = new.estudiante_id
    and ea.principal = true
    and coalesce(ea.autorizado_notificaciones, false) = true
    and nullif(trim(a.correo), '') is not null;
  get diagnostics avisos_correo = row_count;
  hay_aviso := avisos_correo > 0;

  insert into public.observaciones_notificaciones (observacion_id, acudiente_id, canal, destino)
  select new.id, a.id, 'whatsapp', a.telefono_whatsapp
  from public.estudiantes_acudientes ea
  join public.acudientes a on a.id = ea.acudiente_id
  where ea.estudiante_id = new.estudiante_id
    and ea.principal = true
    and coalesce(ea.autorizado_notificaciones, false) = true
    and nullif(trim(a.telefono_whatsapp), '') is not null;
  if found then hay_aviso := true; end if;

  update public.observaciones
  set estado_notificacion = case when hay_aviso then 'pendiente' else 'sin_contacto' end,
      updated_at = now()
  where id = new.id;
  return new;
end;
$$;
