-- CharryComunica - Catálogo de situaciones Tipo I del Manual de Convivencia.
-- Ejecute este archivo UNA vez en Supabase > SQL Editor.

alter table public.observaciones
  add column if not exists falta_tipo_i text
    check (falta_tipo_i is null or falta_tipo_i in (
      'lenguaje_occasional','conflicto_interpersonal','discusion_verbal','juego_brusco',
      'interrupcion_clase','dispositivo_no_autorizado','incumplimiento_acuerdos',
      'pertenencias_sin_autorizacion','molestia_esporadica','copia_no_estructurada',
      'irrespeto_momentaneo','tardanzas_frecuentes'
    ));

create index if not exists observaciones_falta_tipo_i_idx
  on public.observaciones (falta_tipo_i)
  where falta_tipo_i is not null;
