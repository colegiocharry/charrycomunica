-- Gestión de docentes, cursos y privilegios de CharryComunica.
-- Ejecute este archivo UNA sola vez en Supabase > SQL Editor.

begin;

create table if not exists public.docentes_cursos (
  docente_id uuid not null references public.docentes(id) on delete cascade,
  curso_id uuid not null references public.cursos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (docente_id, curso_id)
);

create index if not exists docentes_cursos_curso_id_idx on public.docentes_cursos(curso_id);

create or replace function public.puede_gestionar_docentes()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.id = auth.uid()
      and p.activo = true
      and p.rol::text in ('administrador', 'rectoria')
  );
$$;

grant execute on function public.puede_gestionar_docentes() to authenticated;

alter table public.docentes_cursos enable row level security;

drop policy if exists "Administracion y rectoria gestionan cursos docentes" on public.docentes_cursos;
create policy "Administracion y rectoria gestionan cursos docentes"
on public.docentes_cursos
for all to authenticated
using (public.puede_gestionar_docentes())
with check (public.puede_gestionar_docentes());

-- Las asignaciones específicas reemplazan el acceso automático por jornada/nivel.
-- Orientación, directivos, rectoría y administración mantienen acceso institucional.
create or replace function public.puede_acceder_curso(p_curso_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.es_equipo_directivo()
    or exists (
      select 1
      from public.docentes d
      join public.cursos c on c.id = p_curso_id
      where d.usuario_id = auth.uid()
        and d.activo = true
        and (
          d.area in ('ORIENTACION', 'DIRECTIVO DOCENTE')
          or (
            exists (select 1 from public.docentes_cursos dc where dc.docente_id = d.id)
            and exists (
              select 1 from public.docentes_cursos dc
              where dc.docente_id = d.id and dc.curso_id = p_curso_id
            )
          )
          or (
            not exists (select 1 from public.docentes_cursos dc where dc.docente_id = d.id)
            and (d.acceso_jornada = 'ambas' or d.acceso_jornada = c.jornada::text)
            and (
              d.nivel_ensenanza = 'Global'
              or (d.nivel_ensenanza = 'Preescolar' and lower(c.grado) like 'trans%')
              or (d.nivel_ensenanza = 'Básica Primaria' and regexp_replace(c.grado, '\D', '', 'g') in ('1', '2', '3', '4', '5'))
              or (d.nivel_ensenanza = 'Básica Secundaria y Media' and regexp_replace(c.grado, '\D', '', 'g') in ('6', '7', '8', '9', '10', '11'))
            )
          )
        )
    );
$$;

-- Asegura que la cuenta institucional de Juan conserve administración.
update public.perfiles
set rol = 'administrador', activo = true
where lower(correo) = 'admin@colegiocharry.edu.co';

commit;
