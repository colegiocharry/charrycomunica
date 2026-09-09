(() => {
  const cfg = window.CHARRY_CONFIG || {};
  const configured = cfg.supabaseUrl && cfg.supabasePublishableKey && !cfg.supabasePublishableKey.includes("REEMPLAZAR");
  const libraryReady = Boolean(window.supabase?.createClient);
  const db = configured && libraryReady ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey) : null;
  const $ = s => document.querySelector(s);
  const estados = { presente: "Presente", tarde: "Tarde", evasion: "Evasión" };
  let perfil = null, cursos = [], estudiantes = [], asistencia = new Map(), informeDatos = [];

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
    $("#crearDocentes").hidden=!["administrador","rectoria"].includes(data.rol);
    $("#login").hidden=true; $("#app").hidden=false;
    await cargarCursos();
  }

  async function cargarCursos() {
    const { data, error } = await db.from("cursos").select("id,anio_escolar,grado,grupo,jornada,activo").eq("activo",true).order("jornada").order("grado").order("grupo");
    if (error) return mostrar("#mensaje", `No se pudieron cargar los cursos: ${error.message}`, true);
    cursos=(data||[]).sort(ordenarCursos); const opciones=cursos.map(c=>`<option value="${c.id}">${esc(nombreCurso(c))} · ${esc(c.jornada.replaceAll("_"," "))}</option>`).join("");
    $("#curso").innerHTML=opciones; $("#cursoEstudiantes").innerHTML=opciones; $("#estudianteCurso").innerHTML=opciones; $("#cursoInforme").innerHTML=opciones;
    $("#desdeInforme").value=$("#fecha").value; $("#hastaInforme").value=$("#fecha").value;
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
  if($("#nuevoEstudiante")) $("#nuevoEstudiante").onclick=()=>abrirEstudiante(); if($("#cerrarEstudiante")) $("#cerrarEstudiante").onclick=cerrarEstudiante; if($("#cancelarEstudiante")) $("#cancelarEstudiante").onclick=cerrarEstudiante; if($("#buscarEstudiante")) $("#buscarEstudiante").oninput=renderEstudiantes;
  if($("#cursoEstudiantes")) $("#cursoEstudiantes").onchange=()=>{$("#curso").value=$("#cursoEstudiantes").value;cargarEstudiantes();};

  $("#guardar").onclick=async()=>{
    const boton=$("#guardar"); boton.disabled=true; mostrar("#mensaje","Guardando…");
    const filas=estudiantes.map(e=>({estudiante_id:e.id,curso_id:e.curso_id,fecha:$("#fecha").value,estado:asistencia.get(e.id)||"presente",registrado_por:perfil.id}));
    const { error }=await db.from("asistencias").upsert(filas,{onConflict:"estudiante_id,fecha"});
    boton.disabled=false; if(error)return mostrar("#mensaje",`No se pudo guardar: ${error.message}`,true); mostrar("#mensaje","Asistencia guardada correctamente.");
  };
  $("#curso").onchange=cargarEstudiantes; $("#fecha").onchange=cargarAsistencia; $("#buscar").oninput=render;
  $("#generarInforme").onclick=cargarInforme; $("#descargarInforme").onclick=descargarInforme;
  $("#crearDocentes").onclick=async()=>{
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
  $("#cambiarContrasena").onclick=async()=>{
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
  document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{const vista=$("#"+b.dataset.view); if(!vista)return; document.querySelectorAll("nav button").forEach(x=>x.classList.remove("activo"));document.querySelectorAll(".vista").forEach(x=>x.classList.remove("activa"));b.classList.add("activo");vista.classList.add("activa");$("#titulo").textContent=({asistencia:"Control de asistencia",estadisticas:"Estadísticas",estudiantes:"Gestión de estudiantes"})[b.dataset.view]; if(b.dataset.view==="estadisticas") cargarInforme();});
  iniciar();
})();
