-- Permite a cada usuario autenticado administrar solamente estudiantes de
-- los cursos a los que ya tiene acceso, junto con su acudiente principal.

create or replace function public.puede_acceder_estudiante(p_estudiante_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.estudiantes e
    where e.id = p_estudiante_id
      and public.puede_acceder_curso(e.curso_id)
  );
$$;

create or replace function public.puede_acceder_acudiente(p_acudiente_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.estudiantes_acudientes ea
    where ea.acudiente_id = p_acudiente_id
      and public.puede_acceder_estudiante(ea.estudiante_id)
  );
$$;

grant execute on function public.puede_acceder_estudiante(uuid) to authenticated;
grant execute on function public.puede_acceder_acudiente(uuid) to authenticated;
grant select, insert, update on public.estudiantes to authenticated;
grant select, insert, update on public.acudientes to authenticated;
grant select, insert on public.estudiantes_acudientes to authenticated;

drop policy if exists "Usuarios gestionan estudiantes autorizados" on public.estudiantes;
create policy "Usuarios gestionan estudiantes autorizados"
on public.estudiantes for all to authenticated
using (public.puede_acceder_curso(curso_id))
with check (public.puede_acceder_curso(curso_id));

drop policy if exists "Usuarios consultan relaciones autorizadas" on public.estudiantes_acudientes;
create policy "Usuarios consultan relaciones autorizadas"
on public.estudiantes_acudientes for select to authenticated
using (public.puede_acceder_estudiante(estudiante_id));

drop policy if exists "Usuarios crean relaciones autorizadas" on public.estudiantes_acudientes;
create policy "Usuarios crean relaciones autorizadas"
on public.estudiantes_acudientes for insert to authenticated
with check (public.puede_acceder_estudiante(estudiante_id));

drop policy if exists "Usuarios consultan acudientes autorizados" on public.acudientes;
create policy "Usuarios consultan acudientes autorizados"
on public.acudientes for select to authenticated
using (public.puede_acceder_acudiente(id));

drop policy if exists "Usuarios actualizan acudientes autorizados" on public.acudientes;
create policy "Usuarios actualizan acudientes autorizados"
on public.acudientes for update to authenticated
using (public.puede_acceder_acudiente(id))
with check (public.puede_acceder_acudiente(id));

drop policy if exists "Usuarios crean acudientes" on public.acudientes;
create policy "Usuarios crean acudientes"
on public.acudientes for insert to authenticated
with check (true);
