(() => {
  const cfg = window.CHARRY_CONFIG || {};
  const configured = cfg.supabaseUrl && cfg.supabasePublishableKey && !cfg.supabasePublishableKey.includes("REEMPLAZAR");
  const libraryReady = Boolean(window.supabase?.createClient);
  const db = configured && libraryReady ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey) : null;
  const $ = s => document.querySelector(s);
  const estados = { presente: "Presente", tarde: "Tarde", evasion: "Evasión" };
  let perfil = null, cursos = [], estudiantes = [], asistencia = new Map(), informeDatos = [], observaciones = [];

  const fechaLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const nombreCurso = c => `${c.grado}${c.grupo}`;
  const ordenJornada = { "mañana": 0, "tarde": 1, "fin_de_semana": 2 };
  const numeroGrado = grado => /^trans/i.test(grado) ? 0 : Number.parseInt(grado, 10) || 99;
  const ordenarCursos = (a,b) => (ordenJornada[a.jornada]??9)-(ordenJornada[b.jornada]??9) || numeroGrado(a.grado)-numeroGrado(b.grado) || Number.parseInt(a.grupo,10)-Number.parseInt(b.grupo,10);
  const iniciales = n => n.split(/\s+/).map(x => x[0]).join("").slice(0,2).toUpperCase();
  const esc = v => String(v ?? "").replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
  const mostrar = (sel, texto, error=false) => { const el=$(sel); el.textContent=texto; el.style.color=error?"var(--rojo)":"var(--verde)"; };

  async function iniciar() {
    $("#fecha").value = fechaLocal();
    if (!configured) { mostrar("#loginMensaje", "Falta configurar la clave Publishable de Supabase.", true); return; }
    if (!libraryReady) { mostrar("#loginMensaje", "No se pudo cargar el componente de conexión. Recargue la página.", true); return; }
    try {
      const { data:{ session } } = await db.auth.getSession();
      if (session) await abrirApp(session.user);
    } catch (error) {
      mostrar("#loginMensaje", `No fue posible iniciar la conexión: ${error.message}`, true);
    }
    db.auth.onAuthStateChange((_event, sessionActual) => { if (!sessionActual) { $("#app").hidden=true; $("#login").hidden=false; } });
  }

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault(); mostrar("#loginMensaje", "Verificando…");
    try {
      const usuario = $("#email").value.trim().toLocaleLowerCase("es");
      // Los docentes pueden escribir solamente nombre.apellido; Supabase recibe el correo interno asociado.
      const email = usuario.includes("@") ? usuario : `${usuario}@colegiocharry.edu.co`;
      const intento = db.auth.signInWithPassword({ email, password: $("#password").value });
      const limite = new Promise((_, reject) => setTimeout(() => reject(new Error("La conexión tardó demasiado. Revise Internet y vuelva a intentar.")), 15000));
      const { data, error } = await Promise.race([intento, limite]);
      $("#password").value = "";
      if (error) return mostrar("#loginMensaje", `No fue posible ingresar: ${error.message}`, true);
      await abrirApp(data.user);
    } catch (error) {
      $("#password").value = "";
      mostrar("#loginMensaje", error.message, true);
    }
  });

  async function abrirApp(user) {
    const { data, error } = await db.from("perfiles").select("id,nombres,apellidos,correo,rol,activo").eq("id", user.id).single();
    if (error || !data?.activo) { await db.auth.signOut(); return mostrar("#loginMensaje", "La cuenta no tiene un perfil activo autorizado.", true); }
    perfil=data; const nombre=`${data.nombres} ${data.apellidos}`.trim();
    $("#nombrePerfil").textContent=nombre; $("#rolPerfil").textContent=data.rol; $("#avatar").textContent=iniciales(nombre); $("#saludo").textContent=`Bienvenido, ${data.nombres}`;
    if ($("#crearDocentes")) $("#crearDocentes").hidden=!["administrador","rectoria"].includes(data.rol);
    $("#login").hidden=true; $("#app").hidden=false;
    await cargarCursos();
  }

  async function cargarCursos() {
    const { data, error } = await db.from("cursos").select("id,anio_escolar,grado,grupo,jornada,activo").eq("activo",true).order("jornada").order("grado").order("grupo");
    if (error) return mostrar("#mensaje", `No se pudieron cargar los cursos: ${error.message}`, true);
    cursos=(data||[]).sort(ordenarCursos); const opciones=cursos.map(c=>`<option value="${c.id}">${esc(nombreCurso(c))} · ${esc(c.jornada.replaceAll("_"," "))}</option>`).join("");
    ["#curso","#cursoEstudiantes","#estudianteCurso","#cursoInforme","#cursoObservador"].forEach(selector=>{ if($(selector)) $(selector).innerHTML=opciones; });
    if($("#desdeInforme")) $("#desdeInforme").value=$("#fecha").value;
    if($("#hastaInforme")) $("#hastaInforme").value=$("#fecha").value;
    await cargarEstudiantes();
  }

  async function cargarEstudiantes() {
    const cursoId=$("#curso").value; const c=cursos.find(x=>x.id===cursoId); $("#jornada").textContent=c?`Jornada ${c.jornada.replaceAll("_"," ")}`:"";
    const { data, error } = await db.from("estudiantes").select("id,codigo_interno,nombres,apellidos,curso_id,activo").eq("curso_id",cursoId).eq("activo",true).order("apellidos").order("nombres");
    if (error) return mostrar("#mensaje", `No se pudieron cargar los estudiantes: ${error.message}`, true);
    estudiantes=data||[]; await cargarAsistencia();
  }

  async function cargarAsistencia() {
    asistencia=new Map(); const cursoId=$("#curso").value, fecha=$("#fecha").value;
    const { data, error } = await db.from("asistencias").select("*").eq("curso_id",cursoId).eq("fecha",fecha);
    if (error) mostrar("#mensaje", `No se pudo consultar la asistencia: ${error.message}`, true);
    (data||[]).forEach(x=>asistencia.set(x.estudiante_id,x.estado)); render();
  }

  function render() {
    const q=$("#buscar").value.trim().toLowerCase(); const lista=estudiantes.filter(e=>`${e.nombres} ${e.apellidos}`.toLowerCase().includes(q));
    const contar=e=>estudiantes.filter(x=>(asistencia.get(x.id)||"presente")===e).length;
    $("#metricas").innerHTML=Object.entries(estados).map(([k,v])=>`<div class="metrica"><small>${v}</small><strong>${contar(k)}</strong></div>`).join("");
    $("#metricasGlobales").innerHTML=$("#metricas").innerHTML;
    $("#filas").innerHTML=lista.map((e,i)=>{const nombre=`${e.apellidos} ${e.nombres}`.trim(),actual=asistencia.get(e.id)||"presente";return `<tr><td>${i+1}</td><td><div class="persona"><span class="inicial">${iniciales(nombre)}</span><strong>${esc(nombre)}</strong></div></td><td><span class="pill">${esc(nombreCurso(cursos.find(c=>c.id===e.curso_id)||{grado:"",grupo:""}))}</span></td><td><div class="estados">${Object.entries(estados).map(([k,v])=>`<button class="estado ${actual===k?"sel":""}" data-id="${e.id}" data-estado="${k}">${v}</button>`).join("")}</div></td></tr>`}).join("");
    const total=Math.max(estudiantes.length,1); $("#resumen").innerHTML=Object.entries(estados).map(([k,v])=>`<div><b>${v}: ${contar(k)}</b><div class="barra"><span style="width:${contar(k)/total*100}%;background:${k==='presente'?'var(--verde)':k==='tarde'?'var(--ambar)':'var(--rojo)'}"></span></div></div>`).join("");
    document.querySelectorAll(".estado").forEach(b=>b.onclick=()=>{asistencia.set(b.dataset.id,b.dataset.estado);render();}); renderEstudiantes();
  }

  async function cargarInforme() {
    const cursoId=$("#cursoInforme").value, desde=$("#desdeInforme").value, hasta=$("#hastaInforme").value;
    if (!cursoId || !desde || !hasta) return;
    if (desde > hasta) { mostrar("#mensajeInforme","La fecha inicial no puede ser posterior a la fecha final.",true); return; }
    mostrar("#mensajeInforme","Generando informe…");
    const [{data: listaEstudiantes,error:errorEstudiantes},{data: registros,error:errorRegistros}] = await Promise.all([
      db.from("estudiantes").select("id,nombres,apellidos").eq("curso_id",cursoId).eq("activo",true).order("apellidos").order("nombres"),
      db.from("asistencias").select("fecha,estado,estudiante_id").eq("curso_id",cursoId).gte("fecha",desde).lte("fecha",hasta).order("fecha",{ascending:false})
    ]);
    if (errorEstudiantes || errorRegistros) return mostrar("#mensajeInforme",`No se pudo generar el informe: ${(errorEstudiantes||errorRegistros).message}`,true);
    const nombres = new Map((listaEstudiantes||[]).map(e=>[e.id,`${e.apellidos} ${e.nombres}`.trim()]));
    const curso=cursos.find(c=>c.id===cursoId), datos=(registros||[]).map(r=>({fecha:r.fecha,estudiante:nombres.get(r.estudiante_id)||"Estudiante no disponible",curso:nombreCurso(curso),estado:r.estado})).sort((a,b)=>b.fecha.localeCompare(a.fecha)||a.estudiante.localeCompare(b.estudiante,"es"));
    informeDatos=datos; const cuenta=Object.fromEntries(Object.keys(estados).map(e=>[e,datos.filter(d=>d.estado===e).length]));
    $("#metricasGlobales").innerHTML=Object.entries(estados).map(([k,n])=>`<div class="metrica"><small>${n}</small><strong>${cuenta[k]}</strong></div>`).join("");
    $("#resumen").innerHTML=`<p><strong>${curso?nombreCurso(curso):""}</strong> · ${desde} a ${hasta} · ${datos.length} registros</p>`;
    $("#filasInforme").innerHTML=datos.map(d=>`<tr><td>${esc(d.fecha)}</td><td>${esc(d.estudiante)}</td><td><span class="pill">${esc(d.curso)}</span></td><td>${esc(estados[d.estado]||d.estado)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No hay asistencias registradas en este periodo.</td></tr>`;
    mostrar("#mensajeInforme",datos.length?"Informe actualizado.":"No hay registros para el periodo seleccionado.");
  }

  function descargarInforme() {
    if(!informeDatos.length) return mostrar("#mensajeInforme","Primero genere un informe con registros para descargar.",true);
    const filas=informeDatos.map(r=>`<tr><td>${esc(r.fecha)}</td><td>${esc(r.estudiante)}</td><td>${esc(r.curso)}</td><td>${esc(estados[r.estado]||r.estado)}</td></tr>`).join("");
    const curso=cursos.find(c=>c.id===$("#cursoInforme").value);
    const contenido=`<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial}th{background:#6d2436;color:#fff}th,td{border:1px solid #c9c9c9;padding:8px;text-align:left}h1{color:#6d2436}</style></head><body><h1>Informe de asistencias</h1><p>Curso: ${esc(curso?nombreCurso(curso):"")}<br>Periodo: ${esc($("#desdeInforme").value)} a ${esc($("#hastaInforme").value)}</p><table><thead><tr><th>Fecha</th><th>Estudiante</th><th>Curso</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></body></html>`;
    const blob=new Blob(["\ufeff"+contenido],{type:"application/vnd.ms-excel;charset=utf-8"}), enlace=URL.createObjectURL(blob), a=document.createElement("a"); a.href=enlace; a.download=`informe-asistencia-${$("#desdeInforme").value}-a-${$("#hastaInforme").value}.xls`; a.click(); setTimeout(()=>URL.revokeObjectURL(enlace),1000);
  }

  function renderEstudiantes() {
    // Evita que una copia antigua de la página bloquee todo el menú durante una actualización.
    if (!$("#buscarEstudiante") || !$("#filasEstudiantes") || !$("#cursoEstudiantes")) return;
    const q=$("#buscarEstudiante").value.trim().toLocaleLowerCase("es");
    const lista = [...estudiantes].filter(e => `${e.apellidos} ${e.nombres}`.toLocaleLowerCase("es").includes(q));
    lista.sort((a,b)=>`${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`,"es",{sensitivity:"base"}));
    const curso=cursos.find(c=>c.id===$("#cursoEstudiantes").value);
    $("#filasEstudiantes").innerHTML=lista.map((e,i)=>{const nombre=`${e.apellidos} ${e.nombres}`.trim();return `<tr><td>${i+1}</td><td><div class="persona"><span class="inicial">${iniciales(nombre)}</span><strong>${esc(nombre)}</strong></div></td><td><span class="pill">${esc(curso?nombreCurso(curso):"")}</span></td><td><div class="acciones-estudiante"><button class="accion editar-estudiante" data-id="${e.id}">Editar</button><button class="accion eliminar eliminar-estudiante" data-id="${e.id}">Eliminar</button></div></td></tr>`}).join("");
    document.querySelectorAll(".editar-estudiante").forEach(b=>b.onclick=()=>abrirEstudiante(b.dataset.id));
    document.querySelectorAll(".eliminar-estudiante").forEach(b=>b.onclick=()=>eliminarEstudiante(b.dataset.id));
  }

  async function abrirEstudiante(id="") {
    const e=estudiantes.find(x=>x.id===id);
    $("#estudianteId").value=e?.id||""; $("#estudianteNombres").value=e?.nombres||""; $("#estudianteApellidos").value=e?.apellidos||""; $("#estudianteCurso").value=e?.curso_id||$("#cursoEstudiantes").value;
    $("#acudienteId").value=""; $("#acudienteNombres").value=""; $("#acudienteApellidos").value=""; $("#acudienteCorreo").value=""; $("#acudienteWhatsapp").value="";
    $("#tituloEstudiante").textContent=e?"Editar estudiante":"Añadir estudiante"; $("#mensajeFormulario").textContent=""; $("#modalEstudiante").hidden=false;
    if (!e) return;
    const {data: relacion,error}=await db.from("estudiantes_acudientes").select("acudiente_id,acudientes(id,nombres,apellidos,correo,telefono_whatsapp)").eq("estudiante_id",id).eq("principal",true).maybeSingle();
    if(error) return mostrar("#mensajeFormulario",`No se pudo consultar el acudiente: ${error.message}`,true);
    const a=Array.isArray(relacion?.acudientes)?relacion.acudientes[0]:relacion?.acudientes;
    if(a) { $("#acudienteId").value=a.id; $("#acudienteNombres").value=a.nombres||""; $("#acudienteApellidos").value=a.apellidos||""; $("#acudienteCorreo").value=a.correo||""; $("#acudienteWhatsapp").value=a.telefono_whatsapp||""; }
  }
  function cerrarEstudiante(){ $("#modalEstudiante").hidden=true; $("#formEstudiante").reset(); }
  async function eliminarEstudiante(id) {
    const e=estudiantes.find(x=> x.id===id); if(!e||!confirm(`¿Desea retirar a ${e.nombres} ${e.apellidos}? Se conservará su historial.`))return;
    const {error}=await db.from("estudiantes").update({activo:false}).eq("id",id); if(error)return mostrar("#mensajeEstudiantes",`No se pudo eliminar: ${error.message}`,true); mostrar("#mensajeEstudiantes","Estudiante retirado. Su historial permanece protegido."); await cargarEstudiantes();
  }

  const formularioEstudiante=$("#formEstudiante");
  if(formularioEstudiante) formularioEstudiante.onsubmit=async ev=>{
    ev.preventDefault();
    const id=$("#estudianteId").value;
    const datos={nombres:$("#estudianteNombres").value.trim(),apellidos:$("#estudianteApellidos").value.trim(),curso_id:$("#estudianteCurso").value,activo:true};
    const acudiente={nombres:$("#acudienteNombres").value.trim(),apellidos:$("#acudienteApellidos").value.trim(),correo:$("#acudienteCorreo").value.trim()||null,telefono_whatsapp:$("#acudienteWhatsapp").value.trim()||null};
    const hayDatosAcudiente=Object.values(acudiente).some(Boolean);
    if(hayDatosAcudiente && (!acudiente.nombres || !acudiente.apellidos)) return mostrar("#mensajeFormulario","Para guardar un acudiente, escriba sus nombres y apellidos.",true);
    $("#guardarEstudiante").disabled=true;
    let estudianteId=id;
    let error;
    if(id) ({error}=await db.from("estudiantes").update(datos).eq("id",id));
    else { const respuesta=await db.from("estudiantes").insert(datos).select("id").single(); error=respuesta.error; estudianteId=respuesta.data?.id; }
    if(!error && hayDatosAcudiente) {
      const acudienteId=$("#acudienteId").value;
      if(acudienteId) ({error}=await db.from("acudientes").update(acudiente).eq("id",acudienteId));
      else {
        const respuesta=await db.from("acudientes").insert(acudiente).select("id").single(); error=respuesta.error;
        if(!error) ({error}=await db.from("estudiantes_acudientes").insert({estudiante_id:estudianteId,acudiente_id:respuesta.data.id,principal:true,autorizado_notificaciones:true}));
      }
    }
    $("#guardarEstudiante").disabled=false;
    if(error)return mostrar("#mensajeFormulario",`No se pudo guardar: ${error.message}`,true);
    cerrarEstudiante(); $("#curso").value=datos.curso_id; $("#cursoEstudiantes").value=datos.curso_id; await cargarEstudiantes();
    mostrar("#mensajeEstudiantes",id?"Estudiante y datos de acudiente actualizados.":"Estudiante añadido correctamente.");
  };

  function estadoNotificacion(estado) {
    return ({ pendiente:"Pendiente", enviado:"Enviado", sin_contacto:"Sin contacto", error:"Requiere revisión" })[estado] || "No programada";
  }

  const etiquetasClasificacion={seguimiento:"Seguimiento formativo",tipo_i:"Situación Tipo I",tipo_ii:"Situación Tipo II",tipo_iii:"Situación Tipo III"};
  const faltasTipoI={
    lenguaje_occasional:"Uso ocasional de palabras inadecuadas, burlas, apodos o expresiones despectivas",
    conflicto_interpersonal:"Conflicto por desacuerdos académicos, deportivos o de juego",
    discusion_verbal:"Discusión verbal sin agresión física ni amenazas", juego_brusco:"Juego brusco sin lesiones",
    interrupcion_clase:"Interrupción o alteración leve de la clase", dispositivo_no_autorizado:"Uso inadecuado o no autorizado de dispositivos electrónicos",
    incumplimiento_acuerdos:"Incumplimiento ocasional de acuerdos de aula o normas de convivencia",
    pertenencias_sin_autorizacion:"Tomar, esconder o cambiar de lugar pertenencias sin autorización",
    molestia_esporadica:"Molestar esporádicamente a un compañero", copia_no_estructurada:"Copiar tareas o durante una evaluación, sin fraude estructurado",
    irrespeto_momentaneo:"Manifestación momentánea de irrespeto", tardanzas_frecuentes:"Llegadas tarde frecuentes sin justificación"
  };
  const protocolosObservador={
    seguimiento:{instancia:"aula",texto:"Registro formativo. Describa hechos verificables, acuerde acciones pedagógicas y haga seguimiento respetando la confidencialidad."},
    tipo_i:{instancia:"aula",texto:"Tipo I: atienda de inmediato en el aula, detenga el comportamiento, realice conversación restaurativa, acuerde una reparación y registre los compromisos. Informe a la familia si hay recurrencia o se requiere corresponsabilidad."},
    tipo_ii:{instancia:"coordinacion_convivencia",texto:"Tipo II: no se gestiona solo desde el aula. Remita a Coordinación de Convivencia para activar el protocolo institucional, proteger a las personas involucradas y realizar seguimiento. No se envía un aviso automático a la familia desde este formulario."},
    tipo_iii:{instancia:"rectoria_comite",texto:"Tipo III: requiere activación inmediata de la Ruta de Atención Integral, protección de derechos e información a Rectoría / Comité Escolar de Convivencia. No describa detalles sensibles aquí ni envíe aviso automático; siga el protocolo institucional y las rutas externas competentes."}
  };

  function actualizarProtocoloObservador(){
    const clasificacion=$("#observacionClasificacion")?.value || "seguimiento";
    const protocolo=protocolosObservador[clasificacion] || protocolosObservador.seguimiento;
    const cuadro=$("#protocoloObservador"), remision=$("#observacionRemision"), aviso=$("#notificarAcudiente"), textoAviso=$("#avisoObservador"), campoFalta=$("#campoFaltaTipoI"), falta=$("#observacionFaltaTipoI");
    if(cuadro){ cuadro.classList.toggle("urgente",clasificacion==="tipo_iii"); cuadro.innerHTML=`<strong>${etiquetasClasificacion[clasificacion] || "Registro"}</strong>${protocolo.texto}`; }
    if(remision) remision.value=protocolo.instancia;
    const sensible=["tipo_ii","tipo_iii"].includes(clasificacion);
    if(campoFalta) campoFalta.hidden=clasificacion!=="tipo_i";
    if(falta){ falta.required=clasificacion==="tipo_i"; if(clasificacion!=="tipo_i") falta.value=""; }
    if(aviso){ aviso.disabled=sensible; if(sensible) aviso.checked=false; else if(!aviso.checked) aviso.checked=true; }
    if(textoAviso) textoAviso.textContent=sensible?"Por protección, la comunicación con la familia será definida por la instancia institucional responsable; no se prepara un aviso automático.":"Al guardar, el aviso queda pendiente. El envío automático se habilitará al conectar el correo institucional o WhatsApp.";
  }

  function renderObservador() {
    if (!$("#filasObservador")) return;
    const q=$("#buscarObservacion")?.value.trim().toLocaleLowerCase("es") || "";
    const lista=observaciones.filter(o=>`${o.estudiantes?.apellidos||""} ${o.estudiantes?.nombres||""} ${o.titulo||""}`.toLocaleLowerCase("es").includes(q));
    $("#filasObservador").innerHTML=lista.map(o=>{
      const estudiante=`${o.estudiantes?.apellidos||""} ${o.estudiantes?.nombres||""}`.trim() || "Estudiante";
      const extracto=(o.descripcion||"").length>105?`${o.descripcion.slice(0,105)}…`:o.descripcion||"";
      const falta=o.falta_tipo_i?`<br><small class="muted">${esc(faltasTipoI[o.falta_tipo_i]||o.falta_tipo_i)}</small>`:"";
      return `<tr><td>${esc(o.fecha)}</td><td><strong>${esc(estudiante)}</strong></td><td><span class="pill">${esc(etiquetasClasificacion[o.clasificacion]||o.tipo)}</span><br><small class="muted">${esc(o.tipo)}</small>${falta}</td><td><strong>${esc(o.titulo)}</strong><br><span class="muted">${esc(extracto)}</span></td><td><span class="pill">${esc(estadoNotificacion(o.estado_notificacion))}</span></td></tr>`;
    }).join("") || `<tr><td colspan="5" class="muted">Aún no hay observaciones para este curso.</td></tr>`;
  }

  async function cargarObservador() {
    if (!$("#cursoObservador")) return;
    const cursoId=$("#cursoObservador").value;
    if (!cursoId) return;
    mostrar("#mensajeObservador","Cargando observaciones…");
    const {data,error}=await db.from("observaciones")
      .select("id,fecha,tipo,clasificacion,falta_tipo_i,remision_a,titulo,descripcion,estado_notificacion,estudiante_id,estudiantes(nombres,apellidos)")
      .eq("curso_id",cursoId).order("fecha",{ascending:false}).order("created_at",{ascending:false});
    if(error) { mostrar("#mensajeObservador",`No se pudieron cargar las observaciones: ${error.message}`,true); return; }
    observaciones=data||[]; renderObservador(); mostrar("#mensajeObservador",observaciones.length?"Historial actualizado.":"No hay observaciones registradas en este curso.");
  }

  function abrirObservacion() {
    if (!$("#modalObservacion")) return;
    const cursoId=$("#cursoObservador").value;
    const lista=estudiantes.filter(e=>e.curso_id===cursoId).sort((a,b)=>`${a.apellidos} ${a.nombres}`.localeCompare(`${b.apellidos} ${b.nombres}`,"es"));
    if (!lista.length) { mostrar("#mensajeObservador","Seleccione un curso con estudiantes antes de crear una observación.",true); return; }
    $("#observacionEstudiante").innerHTML=lista.map(e=>`<option value="${e.id}">${esc(`${e.apellidos} ${e.nombres}`.trim())}</option>`).join("");
    $("#formObservacion").reset();
    $("#observacionEstudiante").innerHTML=lista.map(e=>`<option value="${e.id}">${esc(`${e.apellidos} ${e.nombres}`.trim())}</option>`).join("");
    $("#notificarAcudiente").checked=true; $("#mensajeFormularioObservacion").textContent=""; actualizarProtocoloObservador();
    $("#modalObservacion").hidden=false;
  }

  function cerrarObservacion(){ if($("#modalObservacion")) { $("#modalObservacion").hidden=true; $("#formObservacion").reset(); } }

  const formularioObservacion=$("#formObservacion");
  if(formularioObservacion) formularioObservacion.onsubmit=async ev=>{
    ev.preventDefault();
    const cursoId=$("#cursoObservador").value;
    const clasificacion=$("#observacionClasificacion").value;
    const faltaTipoI=clasificacion==="tipo_i" ? $("#observacionFaltaTipoI").value : null;
    if(clasificacion==="tipo_i" && !faltaTipoI) return mostrar("#mensajeFormularioObservacion","Seleccione la falta o situación Tipo I antes de guardar.",true);
    const datos={
      estudiante_id:$("#observacionEstudiante").value, curso_id:cursoId, registrado_por:perfil.id,
      fecha:$("#fecha").value, tipo:$("#observacionTipo").value, clasificacion, falta_tipo_i:faltaTipoI, remision_a:$("#observacionRemision").value,
      titulo:$("#observacionTitulo").value.trim(), descripcion:$("#observacionDescripcion").value.trim(),
      acciones_acordadas:$("#observacionAcciones").value.trim()||null,
      notificar_acudiente:$("#notificarAcudiente").checked
    };
    const boton=$("#guardarObservacion"); boton.disabled=true;
    const {error}=await db.from("observaciones").insert(datos);
    boton.disabled=false;
    if(error) return mostrar("#mensajeFormularioObservacion",`No se pudo guardar: ${error.message}`,true);
    cerrarObservacion(); await cargarObservador(); mostrar("#mensajeObservador",datos.notificar_acudiente?"Observación guardada y aviso preparado para el acudiente.":"Observación guardada correctamente.");
  };
  if($("#nuevaObservacion")) $("#nuevaObservacion").onclick=abrirObservacion;
  if($("#cerrarObservacion")) $("#cerrarObservacion").onclick=cerrarObservacion;
  if($("#cancelarObservacion")) $("#cancelarObservacion").onclick=cerrarObservacion;
  if($("#buscarObservacion")) $("#buscarObservacion").oninput=renderObservador;
  if($("#observacionClasificacion")) $("#observacionClasificacion").onchange=actualizarProtocoloObservador;
  if($("#observacionFaltaTipoI")) $("#observacionFaltaTipoI").onchange=()=>{ const titulo=$("#observacionTitulo"), texto=faltasTipoI[$("#observacionFaltaTipoI").value]; if(titulo && texto && !titulo.value.trim()) titulo.value=texto; };
  if($("#cursoObservador")) $("#cursoObservador").onchange=async()=>{ $("#curso").value=$("#cursoObservador").value; await cargarEstudiantes(); await cargarObservador(); };

  if($("#nuevoEstudiante")) $("#nuevoEstudiante").onclick=()=>abrirEstudiante(); if($("#cerrarEstudiante")) $("#cerrarEstudiante").onclick=cerrarEstudiante; if($("#cancelarEstudiante")) $("#cancelarEstudiante").onclick=cerrarEstudiante; if($("#buscarEstudiante")) $("#buscarEstudiante").oninput=renderEstudiantes;
  if($("#cursoEstudiantes")) $("#cursoEstudiantes").onchange=()=>{$("#curso").value=$("#cursoEstudiantes").value;cargarEstudiantes();};

  $("#guardar").onclick=async()=>{
    const boton=$("#guardar"); boton.disabled=true; mostrar("#mensaje","Guardando…");
    const filas=estudiantes.map(e=>({estudiante_id:e.id,curso_id:e.curso_id,fecha:$("#fecha").value,estado:asistencia.get(e.id)||"presente",registrado_por:perfil.id}));
    const { error }=await db.from("asistencias").upsert(filas,{onConflict:"estudiante_id,fecha"});
    boton.disabled=false; if(error)return mostrar("#mensaje",`No se pudo guardar: ${error.message}`,true); mostrar("#mensaje","Asistencia guardada correctamente.");
  };
  $("#curso").onchange=cargarEstudiantes; $("#fecha").onchange=cargarAsistencia; $("#buscar").oninput=render;
  if($("#generarInforme")) $("#generarInforme").onclick=cargarInforme;
  if($("#descargarInforme")) $("#descargarInforme").onclick=descargarInforme;
  if($("#crearDocentes")) $("#crearDocentes").onclick=async()=>{
    if(!confirm("Se crearán las cuentas pendientes de los docentes. ¿Desea continuar?")) return;
    const boton=$("#crearDocentes"); boton.disabled=true; boton.textContent="Creando cuentas…";
    const {data,error}=await db.functions.invoke("crear-docentes");
    boton.disabled=false; boton.textContent="Crear cuentas docentes";
    if(error) {
      let detalle=error.message;
      try {
        const respuesta=error.context;
        if(respuesta) {
          const cuerpo=await respuesta.clone().json();
          detalle=cuerpo?.error||cuerpo?.message||detalle;
        }
      } catch (_) { /* Se conserva el mensaje original si no llega JSON. */ }
      return alert(`No fue posible crear las cuentas: ${detalle}`);
    }
    alert(`${data?.mensaje||"Proceso finalizado."}\nCuentas omitidas: ${data?.omitidos||0}${data?.errores?.length?`\nErrores: ${data.errores.length}`:""}`);
  };
  $("#salir").onclick=()=>db.auth.signOut();
  if($("#cambiarContrasena")) $("#cambiarContrasena").onclick=async()=>{
    const nueva=prompt("Escriba una nueva contraseña (mínimo 8 caracteres):");
    if(nueva===null) return;
    if(nueva.length<8) return alert("La contraseña debe tener al menos 8 caracteres.");
    const confirmacion=prompt("Repita la nueva contraseña:");
    if(confirmacion===null) return;
    if(nueva!==confirmacion) return alert("Las contraseñas no coinciden.");
    const {error}=await db.auth.updateUser({password:nueva});
    if(error) return alert(`No fue posible cambiar la contraseña: ${error.message}`);
    alert("Contraseña actualizada correctamente.");
  };
  document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{const vista=$("#"+b.dataset.view); if(!vista)return; document.querySelectorAll("nav button").forEach(x=>x.classList.remove("activo"));document.querySelectorAll(".vista").forEach(x=>x.classList.remove("activa"));b.classList.add("activo");vista.classList.add("activa");$("#titulo").textContent=({asistencia:"Control de asistencia",estadisticas:"Estadísticas",estudiantes:"Gestión de estudiantes",observador:"Observador del estudiante"})[b.dataset.view]; if(b.dataset.view==="estadisticas" && $("#cursoInforme")) cargarInforme(); if(b.dataset.view==="observador") cargarObservador();});
  iniciar();
})();
