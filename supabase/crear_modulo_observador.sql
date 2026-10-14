-- CharryComunica · Módulo de observador del estudiante
-- Ejecute este archivo una sola vez desde Supabase > SQL Editor.
-- No elimina ni modifica los datos existentes de asistencia o estudiantes.

create table if not exists public.observaciones (
  id uuid primary key default gen_random_uuid(),
  estudiante_id uuid not null references public.estudiantes(id) on delete restrict,
  curso_id uuid not null references public.cursos(id) on delete restrict,
  registrado_por uuid not null references public.perfiles(id) on delete restrict,
  fecha date not null default current_date,
  tipo text not null check (tipo in ('academica','convivencia','reconocimiento','seguimiento')),
  nivel text not null default 'informativa' check (nivel in ('informativa','leve','moderada','grave')),
  titulo text not null check (length(trim(titulo)) between 3 and 160),
  descripcion text not null check (length(trim(descripcion)) between 3 and 3000),
  acciones_acordadas text,
  notificar_acudiente boolean not null default true,
  estado_notificacion text not null default 'no_programada' check (estado_notificacion in ('no_programada','pendiente','enviado','sin_contacto','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists observaciones_curso_fecha_idx on public.observaciones (curso_id, fecha desc);
create index if not exists observaciones_estudiante_fecha_idx on public.observaciones (estudiante_id, fecha desc);

create table if not exists public.observaciones_notificaciones (
  id uuid primary key default gen_random_uuid(),
  observacion_id uuid not null references public.observaciones(id) on delete cascade,
  acudiente_id uuid not null references public.acudientes(id) on delete restrict,
  canal text not null check (canal in ('correo','whatsapp')),
  destino text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','enviado','sin_contacto','error')),
  enviado_en timestamptz,
  detalle_error text,
  created_at timestamptz not null default now(),
  unique (observacion_id, acudiente_id, canal)
);

create index if not exists observaciones_notificaciones_estado_idx on public.observaciones_notificaciones (estado, created_at);

-- Prepara avisos solamente para el acudiente principal que autorizó notificaciones.
-- El envío queda deliberadamente pendiente hasta conectar Gmail Workspace o WhatsApp.
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
  if not new.notificar_acudiente then
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

drop trigger if exists preparar_notificaciones_observacion on public.observaciones;
create trigger preparar_notificaciones_observacion
after insert on public.observaciones
for each row execute function public.preparar_notificaciones_observacion();

alter table public.observaciones enable row level security;
alter table public.observaciones_notificaciones enable row level security;

drop policy if exists "Usuarios consultan observaciones de cursos autorizados" on public.observaciones;
create policy "Usuarios consultan observaciones de cursos autorizados"
on public.observaciones for select to authenticated
using (public.puede_acceder_curso(curso_id));

drop policy if exists "Usuarios crean observaciones de cursos autorizados" on public.observaciones;
create policy "Usuarios crean observaciones de cursos autorizados"
on public.observaciones for insert to authenticated
with check (public.puede_acceder_curso(curso_id) and registrado_por = auth.uid());

drop policy if exists "Usuarios actualizan observaciones de cursos autorizados" on public.observaciones;
create policy "Usuarios actualizan observaciones de cursos autorizados"
on public.observaciones for update to authenticated
using (public.puede_acceder_curso(curso_id))
with check (public.puede_acceder_curso(curso_id));

drop policy if exists "Usuarios consultan avisos de observaciones autorizadas" on public.observaciones_notificaciones;
create policy "Usuarios consultan avisos de observaciones autorizadas"
on public.observaciones_notificaciones for select to authenticated
using (exists (select 1 from public.observaciones o where o.id = observacion_id and public.puede_acceder_curso(o.curso_id)));

drop policy if exists "Usuarios actualizan avisos de observaciones autorizadas" on public.observaciones_notificaciones;
create policy "Usuarios actualizan avisos de observaciones autorizadas"
on public.observaciones_notificaciones for update to authenticated
using (exists (select 1 from public.observaciones o where o.id = observacion_id and public.puede_acceder_curso(o.curso_id)))
with check (exists (select 1 from public.observaciones o where o.id = observacion_id and public.puede_acceder_curso(o.curso_id)));

grant select, insert, update on public.observaciones to authenticated;
grant select, update on public.observaciones_notificaciones to authenticated;
