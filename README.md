# CharryComunica

Plataforma de asistencia del Colegio Charry IED, conectada a Supabase.

## Configuración local

1. Copia `config.example.js` como `config.js`.
2. En Supabase abre **Connect** y copia únicamente la clave **Publishable** (`sb_publishable_...`).
3. Reemplaza `sb_publishable_REEMPLAZAR` dentro de `config.js`.
4. Abre `index.html` mediante un servidor web local.

Nunca uses aquí la contraseña de la base de datos, `service_role` ni una clave `sb_secret_...`.

## Publicación

El proyecto es estático y puede publicarse desde un repositorio privado de GitHub en Cloudflare Pages. Antes de publicar, genera `config.js` durante la compilación usando variables protegidas de Cloudflare Pages.
