import { withSupabase } from "npm:@supabase/server@^1";

const DOMAIN = "colegiocharry.edu.co";
const ROLES = new Set(["docente", "coordinador", "rectoria", "administrador"]);
const JORNADAS = new Set(["mañana", "tarde", "ambas", "fin_de_semana"]);
const NIVELES = new Set(["Global", "Preescolar", "Básica Primaria", "Básica Secundaria y Media"]);

const texto = (value: unknown, max = 120) => String(value ?? "").trim().slice(0, max);
const respuesta = (body: unknown, status = 200) => Response.json(body, { status });

export default {
  fetch: withSupabase({ auth: "user" }, async (request, ctx) => {
    const { data: { user }, error: errorUsuario } = await ctx.supabase.auth.getUser();
    if (errorUsuario || !user) return respuesta({ error: "Sesión no autorizada." }, 401);

    const { data: perfil, error: errorPerfil } = await ctx.supabase
      .from("perfiles")
      .select("rol,activo")
      .eq("id", user.id)
      .single();
    if (errorPerfil || !perfil?.activo || !["administrador", "rectoria"].includes(String(perfil.rol))) {
      return respuesta({ error: "Solo administración o rectoría puede gestionar docentes." }, 403);
    }

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch (_) { return respuesta({ error: "La solicitud no tiene un formato válido." }, 400); }

    if (body.action === "listar") {
      const { data: docentes, error: errorDocentes } = await ctx.supabaseAdmin
        .from("docentes")
        .select("id,usuario,usuario_id,nombres,apellidos,jornada_origen,acceso_jornada,nivel_ensenanza,area,cargo,activo")
        .order("apellidos", { ascending: true })
        .order("nombres", { ascending: true });
      if (errorDocentes) return respuesta({ error: errorDocentes.message }, 500);

      const ids = (docentes ?? []).map((d) => d.usuario_id).filter(Boolean);
      const { data: perfiles, error: errorPerfiles } = ids.length
        ? await ctx.supabaseAdmin.from("perfiles").select("id,correo,rol,activo").in("id", ids)
        : { data: [], error: null };
      if (errorPerfiles) return respuesta({ error: errorPerfiles.message }, 500);

      const { data: asignaciones, error: errorAsignaciones } = await ctx.supabaseAdmin
        .from("docentes_cursos")
        .select("docente_id,curso_id");
      if (errorAsignaciones) return respuesta({ error: `No se pudieron leer las asignaciones: ${errorAsignaciones.message}` }, 500);

      const perfilesPorId = new Map((perfiles ?? []).map((p) => [p.id, p]));
      const cursosPorDocente = new Map<string, string[]>();
      for (const asignacion of asignaciones ?? []) {
        const actuales = cursosPorDocente.get(asignacion.docente_id) ?? [];
        actuales.push(asignacion.curso_id);
        cursosPorDocente.set(asignacion.docente_id, actuales);
      }
      return respuesta({ docentes: (docentes ?? []).map((d) => {
        const p = d.usuario_id ? perfilesPorId.get(d.usuario_id) : null;
        return { ...d, correo: p?.correo ?? null, rol: p?.rol ?? "docente", activo: Boolean(d.activo && (p?.activo ?? true)), cursos: cursosPorDocente.get(d.id) ?? [] };
      }) });
    }

    if (body.action !== "guardar") return respuesta({ error: "Acción no reconocida." }, 400);

    const id = texto(body.id, 80) || null;
    const usuarioIdIngresado = texto(body.usuario_id, 80) || null;
    const nombres = texto(body.nombres, 100);
    const apellidos = texto(body.apellidos, 100);
    const usuario = texto(body.usuario, 64).toLocaleLowerCase("es");
    const rol = texto(body.rol, 40);
    const accesoJornada = texto(body.acceso_jornada, 40);
    const nivel = texto(body.nivel_ensenanza, 100);
    const cargo = texto(body.cargo, 120) || "Docente";
    const area = texto(body.area, 120) || null;
    const activo = body.activo !== false;
    const contrasena = String(body.contrasena ?? "");
    const cursos = Array.isArray(body.cursos) ? [...new Set(body.cursos.map((c) => texto(c, 80)).filter(Boolean))] : [];

    if (!nombres || !apellidos) return respuesta({ error: "Escriba los nombres y apellidos del docente." }, 400);
    if (!/^[a-z0-9._-]{3,64}$/.test(usuario)) return respuesta({ error: "El usuario debe tener entre 3 y 64 caracteres: letras minúsculas, números, punto, guion o guion bajo." }, 400);
    if (!ROLES.has(rol) || !JORNADAS.has(accesoJornada) || !NIVELES.has(nivel)) return respuesta({ error: "Uno de los permisos, jornada o nivel no es válido." }, 400);
    if (!id && contrasena.length < 8) return respuesta({ error: "La contraseña inicial debe tener al menos 8 caracteres." }, 400);
    if (usuarioIdIngresado === user.id && (!activo || !["administrador", "rectoria"].includes(rol))) return respuesta({ error: "No puede desactivar ni quitar el privilegio administrativo de su propia cuenta." }, 400);

    let docenteActual: Record<string, unknown> | null = null;
    if (id) {
      const { data, error } = await ctx.supabaseAdmin.from("docentes").select("id,usuario_id").eq("id", id).maybeSingle();
      if (error || !data) return respuesta({ error: error?.message ?? "No se encontró el docente." }, 404);
      docenteActual = data;
    }

    let usuarioId = usuarioIdIngresado || String(docenteActual?.usuario_id ?? "") || null;
    const correo = `${usuario}@${DOMAIN}`;
    if (!usuarioId) {
      const { data, error } = await ctx.supabaseAdmin.auth.admin.createUser({
        email: correo, password: contrasena, email_confirm: true,
        user_metadata: { nombres, apellidos },
      });
      if (error || !data.user) return respuesta({ error: error?.message ?? "No fue posible crear la cuenta institucional." }, 400);
      usuarioId = data.user.id;
    } else {
      const { error } = await ctx.supabaseAdmin.auth.admin.updateUserById(usuarioId, {
        email: correo, email_confirm: true, user_metadata: { nombres, apellidos },
      });
      if (error) return respuesta({ error: `No fue posible actualizar la cuenta institucional: ${error.message}` }, 400);
    }

    const perfilDatos = { id: usuarioId, nombres, apellidos, correo, rol, activo };
    const { error: errorGuardarPerfil } = await ctx.supabaseAdmin.from("perfiles").upsert(perfilDatos, { onConflict: "id" });
    if (errorGuardarPerfil) return respuesta({ error: `No fue posible guardar los privilegios: ${errorGuardarPerfil.message}` }, 500);

    const datosDocente = { usuario, usuario_id: usuarioId, nombres, apellidos, jornada_origen: accesoJornada, acceso_jornada: accesoJornada, nivel_ensenanza: nivel, area, cargo, activo };
    let docenteId = id;
    if (id) {
      const { error } = await ctx.supabaseAdmin.from("docentes").update(datosDocente).eq("id", id);
      if (error) return respuesta({ error: `No fue posible actualizar el docente: ${error.message}` }, 500);
    } else {
      const { data, error } = await ctx.supabaseAdmin.from("docentes").insert(datosDocente).select("id").single();
      if (error || !data) return respuesta({ error: `No fue posible registrar el docente: ${error?.message ?? "sin respuesta"}` }, 500);
      docenteId = data.id;
    }

    // Se consulta de nuevo el identificador real del registro. Así se evita
    // asociar cursos a un identificador de perfil o de autenticación.
    const { data: docenteGuardado, error: errorDocenteGuardado } = await ctx.supabaseAdmin
      .from("docentes")
      .select("id")
      .eq("usuario_id", usuarioId)
      .maybeSingle();
    if (errorDocenteGuardado || !docenteGuardado?.id) {
      return respuesta({ error: `No se pudo confirmar el registro docente: ${errorDocenteGuardado?.message ?? "no encontrado"}` }, 500);
    }
    docenteId = docenteGuardado.id;

    const { error: errorEliminarAsignaciones } = await ctx.supabaseAdmin.from("docentes_cursos").delete().eq("docente_id", docenteId);
    if (errorEliminarAsignaciones) return respuesta({ error: `No se pudieron actualizar los cursos: ${errorEliminarAsignaciones.message}` }, 500);
    if (cursos.length) {
      const { error } = await ctx.supabaseAdmin.from("docentes_cursos").insert(cursos.map((cursoId) => ({ docente_id: docenteId, curso_id: cursoId })));
      if (error) return respuesta({ error: `No se pudieron asignar los cursos: ${error.message}` }, 500);
    }

    return respuesta({ mensaje: id ? "Docente y privilegios actualizados correctamente." : "Docente creado correctamente. Ya puede ingresar con su usuario institucional." });
  }),
};
