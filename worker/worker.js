/**
 * El formulario «Solicitar demo» de respondelo.app.
 *
 * La web es estática (GitHub Pages) y no tiene dónde recibir nada: este Worker
 * es ese sitio. Es una copia del de recompensalo.com (repo recompensalo-web, FORMULARIO.md).
 *
 * Rutas:
 *   POST /api/contacto    guarda un pedido de demo (público: lo llama la web)
 *   GET  /api/contactos   lista lo recibido (necesita ADMIN_TOKEN)
 *   GET  /panel           la página para leerlos (la clave la pide la página)
 *
 * El POST es público a propósito: no hay forma de darle una clave a la web sin
 * dejarla escrita en la página. Lo que se protege es la LECTURA. Contra el spam:
 * un campo trampa que solo llenan los bots y un cupo de 5 envíos cada 10 minutos
 * por IP.
 *
 * Bindings: CONTACTOS (KV), ADMIN_TOKEN (secreto). Opcionales, para que además
 * llegue un mail por cada pedido: RESEND_API_KEY (secreto) y AVISO_A (a quién).
 * Sin ellos el pedido se guarda igual: nunca se pierde por el mail.
 */

const ORIGENES = ["https://respondelo.app", "https://www.respondelo.app"];
const REMITENTE = "Respondelo <hola@mail.mflowsuite.com>";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ruta = url.pathname.replace(/\/+$/, "") || "/";
    const origen = request.headers.get("origin") || "";
    const cors = ORIGENES.includes(origen) || /^http:\/\/localhost:\d+$/.test(origen)
      ? { "access-control-allow-origin": origen, vary: "origin" } : {};

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { ...cors, "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "86400" } });
    }
    if (ruta === "/api/contacto" && request.method === "POST") return guardar(request, env, cors);
    if (ruta === "/api/contactos" && request.method === "GET") return listar(request, env);
    if (ruta === "/panel") return new Response(PANEL, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "same-origin" } });
    if (ruta === "/salud") return json({ ok: true });
    return json({ error: "no encontrado" }, 404);
  },
};

function json(cuerpo, status = 200, extra = {}) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });
}

const limpio = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

async function guardar(request, env, cors) {
  const ip = request.headers.get("cf-connecting-ip") || "sin-ip";
  const claveCupo = "cupo:" + ip;
  const usados = Number(await env.CONTACTOS.get(claveCupo)) || 0;
  if (usados >= 5) return json({ error: "Demasiados envíos seguidos. Probá en unos minutos." }, 429, cors);

  let d;
  try { d = await request.json(); } catch { return json({ error: "Datos inválidos" }, 400, cors); }

  // Campo trampa: invisible para las personas. Si viene lleno es un bot: se le
  // dice que salió bien y no se guarda nada.
  if (limpio(d.empresa_web, 200)) return json({ ok: true }, 200, cors);

  const c = {
    nombre: limpio(d.nombre, 80),
    negocio: limpio(d.negocio, 120),
    whatsapp: limpio(d.whatsapp, 30),
    email: limpio(d.email, 120),
    mensaje: String(d.mensaje ?? "").trim().slice(0, 2000),
    plan: limpio(d.plan, 40),
  };
  if (!c.nombre) return json({ error: "Falta tu nombre.", campo: "nombre" }, 400, cors);
  if (!c.negocio) return json({ error: "Falta el nombre de tu negocio.", campo: "negocio" }, 400, cors);
  if (c.whatsapp.replace(/\D/g, "").length < 8) return json({ error: "Revisá el WhatsApp: tiene que tener el código de área.", campo: "whatsapp" }, 400, cors);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return json({ error: "Revisá el email.", campo: "email" }, 400, cors);

  const ahora = Date.now();
  // Clave invertida: la lista de KV sale en orden, así el más nuevo queda primero.
  const id = "c:" + String(9999999999999 - ahora).padStart(13, "0") + "-" + crypto.randomUUID().slice(0, 8);
  await env.CONTACTOS.put(id, JSON.stringify({ ...c, fecha: new Date(ahora).toISOString(), ip, pais: request.cf?.country || "" }));
  await env.CONTACTOS.put(claveCupo, String(usados + 1), { expirationTtl: 600 });

  if (env.RESEND_API_KEY && env.AVISO_A) {
    try { await avisar(env, c); } catch (e) { console.log("contacto.aviso.error", String(e).slice(0, 200)); }
  }
  return json({ ok: true }, 200, cors);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

async function avisar(env, c) {
  const filas = [["Nombre", c.nombre], ["Negocio", c.negocio], ["WhatsApp", c.whatsapp], ["Email", c.email], ["Plan", c.plan || "—"], ["Mensaje", c.mensaje || "—"]]
    .map(([k, v]) => `<tr><td style="padding:6px 12px;color:#64748b">${k}</td><td style="padding:6px 12px">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ from: REMITENTE, to: env.AVISO_A.split(","), reply_to: c.email, subject: `Pedido de demo: ${c.negocio}`, html: `<h2 style="font-family:sans-serif">Nuevo pedido de demo de Respondelo</h2><table style="font-family:sans-serif;font-size:15px">${filas}</table>` }),
  });
  if (!r.ok) throw new Error("Resend " + r.status + " " + (await r.text()).slice(0, 200));
}

async function listar(request, env) {
  const clave = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || clave !== env.ADMIN_TOKEN) return json({ error: "clave incorrecta" }, 401);
  const lista = await env.CONTACTOS.list({ prefix: "c:", limit: 200 });
  const items = await Promise.all(lista.keys.map(async (k) => JSON.parse((await env.CONTACTOS.get(k.name)) || "{}")));
  return json({ contactos: items }, 200, { "cache-control": "no-store" });
}

const PANEL = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pedidos de demo · Respondelo</title>
<style>
:root{--bg:#faf8f5;--card:#fff;--ink:#0f172a;--ink2:#334155;--muted:#5b6474;--line:#e7e2da;--blue:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#111a2e;--ink:#f1f5f9;--ink2:#cbd5e1;--muted:#94a3b8;--line:#1f2a40;--blue:#3b82f6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 16px}
form{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}input{flex:1;min-width:220px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}
button{padding:10px 16px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-weight:600;cursor:pointer}
.c{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:10px}
.c b{font-size:16px}.c small{color:var(--muted)}.c p{margin:6px 0 0;color:var(--ink2);white-space:pre-wrap}
.c a{color:var(--blue)}.vacio{color:var(--muted)}
</style></head><body><div class="wrap">
<h1>Pedidos de demo</h1>
<form id="f"><input id="k" type="password" placeholder="Clave" autocomplete="current-password"><button>Ver</button></form>
<div id="l"></div></div>
<script>
const $=id=>document.getElementById(id);const e=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
try{$("k").value=localStorage.getItem("clave")||""}catch(_){}
async function ver(){const k=$("k").value.trim();try{localStorage.setItem("clave",k)}catch(_){}
const r=await fetch("/api/contactos",{headers:{authorization:"Bearer "+k}});
if(!r.ok){$("l").innerHTML='<p class="vacio">Clave incorrecta.</p>';return}
const {contactos}=await r.json();
$("l").innerHTML=contactos.length?contactos.map(c=>{const wa=String(c.whatsapp||"").replace(/\\D/g,"");
return '<div class="c"><b>'+e(c.negocio)+'</b> · '+e(c.nombre)+(c.plan?' · plan '+e(c.plan):'')+'<br><small>'+new Date(c.fecha).toLocaleString("es-AR")+'</small><br>'+
'<a href="https://wa.me/'+wa+'" target="_blank" rel="noopener">'+e(c.whatsapp)+'</a> · <a href="mailto:'+e(c.email)+'">'+e(c.email)+'</a>'+(c.mensaje?'<p>'+e(c.mensaje)+'</p>':'')+'</div>'}).join(""):'<p class="vacio">Todavía no llegó ningún pedido.</p>'}
$("f").addEventListener("submit",ev=>{ev.preventDefault();ver()});if($("k").value)ver();
</script></body></html>`;
