create or replace function public.puede_acceder_curso(p_curso_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Administración, rectoría y coordinación conservan la vista institucional.
    public.es_equipo_directivo()
    or exists (
      select 1
      from public.docentes d
      join public.cursos c on c.id = p_curso_id
      where d.usuario_id = auth.uid()
        and d.activo = true
        and (
          -- Orientación y directivos pueden consultar toda la institución.
          d.area in ('ORIENTACION', 'DIRECTIVO DOCENTE')
          or (
            (d.acceso_jornada = 'ambas' or d.acceso_jornada = c.jornada::text)
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
