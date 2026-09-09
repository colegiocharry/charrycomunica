import { withSupabase } from "npm:@supabase/server@^1";

const DOMAIN = "colegiocharry.edu.co";

export default {
  // La función solo acepta una sesión válida de CharryComunica.
  fetch: withSupabase({ auth: "user" }, async (_request, ctx) => {
    const { data: { user }, error: errorUsuario } = await ctx.supabase.auth.getUser();
    if (errorUsuario || !user) {
      return Response.json({ error: "Sesión no autorizada." }, { status: 401 });
    }

    // Se consulta el perfil desde la sesión actual, igual que la plataforma.
    const { data: perfil, error: errorPerfil } = await ctx.supabase
      .from("perfiles")
      .select("rol,activo")
      .eq("id", user.id)
      .single();
    if (errorPerfil || !perfil?.activo || !["administrador", "rectoria"].includes(perfil.rol)) {
      return Response.json({ error: "Solo administración o rectoría puede crear cuentas." }, { status: 403 });
    }

    const { data: docentes, error: errorDocentes } = await ctx.supabaseAdmin
      .from("docentes")
      .select("usuario,usuario_id")
      .eq("activo", true)
      .is("usuario_id", null)
      .order("usuario");
    if (errorDocentes) return Response.json({ error: errorDocentes.message }, { status: 500 });

    const creados: string[] = [];
    const omitidos: string[] = [];
    const errores: Array<{ usuario: string; detalle: string }> = [];

    for (const docente of docentes ?? []) {
      const { data, error } = await ctx.supabaseAdmin.auth.admin.createUser({
        email: `${docente.usuario}@${DOMAIN}`,
        password: `${docente.usuario}1111`,
        email_confirm: true,
      });

      if (error) {
        // Una cuenta existente no se modifica ni se le cambia la contraseña.
        if (/already|exists|registered/i.test(error.message)) omitidos.push(docente.usuario);
        else errores.push({ usuario: docente.usuario, detalle: error.message });
      } else if (data.user) {
        creados.push(docente.usuario);
      }
    }

    return Response.json({
      creados: creados.length,
      omitidos: omitidos.length,
      errores,
      mensaje: `Proceso finalizado: ${creados.length} cuentas creadas.`,
    });
  }),
};
