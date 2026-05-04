const firebaseConfig = {
  apiKey: "AIzaSyC7CURzUFKRJOZ2A8djNwNmAd8IsjbIJks",
  authDomain: "titan-carwash.firebaseapp.com",
  projectId: "titan-carwash",
  storageBucket: "titan-carwash.firebasestorage.app",
  messagingSenderId: "728040110707",
  appId: "1:728040110707:web:08fb4150bbbff01fcb4806"
};

firebase.initializeApp(firebaseConfig);
const db   = firebase.firestore();
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// ─── HASH DE CONTRASEÑAS (SHA-256 via Web Crypto) ──────────────
async function hashPass(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'titan_salt_2024'); // salt fijo
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Persistencia offline — hace la app más rápida y permite uso sin internet
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  console.warn('Offline persistence no disponible:', err.code);
});

// ─── v2 UTILIDADES ─────────────────────────────────────────────
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function exportCSV(headers, rows, filename) {
  const bom = '﻿';
  const csv = bom + [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {href:url, download:filename});
  a.click(); URL.revokeObjectURL(url);
}

async function withLoading(btnEl, fn) {
  btnEl.classList.add('loading');
  try { await fn(); } finally { btnEl.classList.remove('loading'); }
}

// ─── HELPERS ───────────────────────────────────────────────────
const COLORS = ['#00c4d4','#2ecc8a','#f0a030','#e05555','#60a5fa','#a78bfa','#fb923c'];
const ICONS  = {Moto:'🏍',Auto:'🚗',SUV:'🚙',Camioneta:'🚐',Bebida:'🥤',Otro:'⭐'};
const DIAS_S = ['Do','Lu','Ma','Mi','Ju','Vi','Sá'];

// Colores y estilos visuales por marca de bebida
const BEBIDA_BRAND = {
  'coca-cola':      {bg:'#e00', text:'#fff', inicial:'C',  borde:'#c00'},
  'coca-cola zero': {bg:'#111', text:'#e00', inicial:'C0', borde:'#e00'},
  'pepsi':          {bg:'#004b93', text:'#fff', inicial:'P', borde:'#003070'},
  'sprite':         {bg:'#1da462', text:'#fff', inicial:'S', borde:'#128a4a'},
  'seven up':       {bg:'#2ecc40', text:'#fff', inicial:'7', borde:'#27ae36'},
  '7up':            {bg:'#2ecc40', text:'#fff', inicial:'7', borde:'#27ae36'},
  'agua':           {bg:'#00b4d8', text:'#fff', inicial:'A', borde:'#0090b0'},
  'fanta':          {bg:'#ff7200', text:'#fff', inicial:'F', borde:'#cc5a00'},
};

function getBrand(nombre) {
  const key = nombre.toLowerCase().trim();
  for(const [k, v] of Object.entries(BEBIDA_BRAND)) {
    if(key.includes(k)) return v;
  }
  return {bg:'#444', text:'#fff', inicial: nombre.charAt(0).toUpperCase(), borde:'#333'};
}

function bebidaIcon(nombre, size=36) {
  const b = getBrand(nombre);
  const ini = b.inicial || nombre.charAt(0).toUpperCase();
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${b.bg};border:2px solid ${b.borde};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.35)}px;font-weight:900;color:${b.text};font-family:var(--font);flex-shrink:0;">${ini}</div>`;
}

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const uid    = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const fmt    = n  => '$' + Number(n||0).toLocaleString('es-AR');
const fmtD   = d  => { if(!d) return ''; const p=d.split('-'); return `${p[2]}/${p[1]}`; };
const fmtDL  = d  => { if(!d) return ''; const p=d.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const semIni = () => {
  const d = new Date();
  const day = d.getDay(); // 0=dom,1=lun,...,6=sab
  // Queremos lunes: si hoy es domingo(0) retrocedemos 6, si es lunes(1) retrocedemos 0, etc.
  const diff = day === 0 ? -6 : 1 - day;
  const l = new Date(d); l.setDate(d.getDate() + diff);
  return `${l.getFullYear()}-${String(l.getMonth()+1).padStart(2,'0')}-${String(l.getDate()).padStart(2,'0')}`;
};
const semFin = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day; // domingo de esta semana
  const s = new Date(d); s.setDate(d.getDate() + diff);
  return `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}`;
};

// ─── STATE ─────────────────────────────────────────────────────
let cu = null;           // current user object
let selSrv = null;       // selected service for confirm
let regTab = 'lavados';  // active tab in registrar

// Cache local (se actualiza con onSnapshot)
let cache = {
  usuarios: [], empleados: [], servicios: [], bebidas: [],
  lavados: [], caja: [], adelantos: [], asistencia: {}, audit: [],
  stockHist: [], semanasPagadas: []
};

// ─── FIRESTORE HELPERS ─────────────────────────────────────────
const col = name => db.collection(name);

async function fsGet(colName) {
  const snap = await db.collection(colName).get();
  return snap.docs.map(d => ({id: d.id, ...d.data()}));
}

async function fsSet(colName, id, data) {
  await db.collection(colName).doc(id).set(data);
}

async function fsAdd(colName, data) {
  const ref = await db.collection(colName).add(data);
  setTimeout(saveLocalCache, 100); // guardar caché tras escribir
  return ref.id;
}

async function fsUpdate(colName, id, data) {
  await db.collection(colName).doc(id).update(data);
  setTimeout(saveLocalCache, 100);
}

async function fsDel(colName, id) {
  await db.collection(colName).doc(id).delete();
  setTimeout(saveLocalCache, 100);
}

// Audit log — no-await para no bloquear la UI
function auditLog(accion, detalle) {
  db.collection('audit').add({
    ts: new Date().toISOString(),
    user: cu?.nombre || '?',
    userId: cu?.id || '?',
    accion, detalle
  }).catch(e => console.warn('audit error', e));
}

// ─── CACHE LOCAL (localStorage) ────────────────────────────────
const LS_KEY = 'titan_cache_v2';
const LS_TS  = 'titan_cache_ts';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function saveLocalCache() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
    localStorage.setItem(LS_TS, Date.now().toString());
  } catch(e) {}
}

function loadLocalCache() {
  try {
    const ts  = parseInt(localStorage.getItem(LS_TS) || '0');
    const raw = localStorage.getItem(LS_KEY);
    if(raw && (Date.now() - ts) < CACHE_TTL) {
      return JSON.parse(raw);
    }
  } catch(e) {}
  return null;
}

// ─── INIT ──────────────────────────────────────────────────────
async function initApp() {
  // onAuthStateChanged maneja la pantalla de login/app
  // Acá solo pre-cargamos datos si hay caché local
  const local = loadLocalCache();
  if(local && local.usuarios && local.usuarios.length > 0) {
    cache = local;
    // El observer de auth decidirá qué mostrar
    refreshFromFirebase();
    return;
  }
  // Sin caché — el observer mostrará loading hasta que Firebase Auth responda
}

async function loadAllFromFirebase() {
  // Todas las consultas EN PARALELO — mucho más rápido
  const [usuarios, empleados, servicios, bebidas, lavados, caja, adelantos, asistSnap, stockHist, semanasPagadas] = await Promise.all([
    db.collection('usuarios').get(),
    db.collection('empleados').get(),
    db.collection('servicios').get(),
    db.collection('bebidas').get(),
    db.collection('lavados').get(),
    db.collection('caja').get(),
    db.collection('adelantos').get(),
    db.collection('asistencia').get(),
    db.collection('stockHist').get(),
    db.collection('semanasPagadas').get(),
  ]);

  cache.usuarios       = usuarios.docs.map(d=>({id:d.id,...d.data()}));
  cache.empleados      = empleados.docs.map(d=>({id:d.id,...d.data()}));
  cache.servicios      = servicios.docs.map(d=>({id:d.id,...d.data()}));
  cache.bebidas        = bebidas.docs.map(d=>({id:d.id,...d.data()}));
  cache.lavados        = lavados.docs.map(d=>({id:d.id,...d.data()}));
  cache.caja           = caja.docs.map(d=>({id:d.id,...d.data()}));
  cache.adelantos      = adelantos.docs.map(d=>({id:d.id,...d.data()}));
  cache.stockHist      = stockHist.docs.map(d=>({id:d.id,...d.data()}));
  cache.semanasPagadas = semanasPagadas.docs.map(d=>({id:d.id,...d.data()}));
  cache.asistencia = {};
  asistSnap.docs.forEach(d => { cache.asistencia[d.id] = d.data().empleados || []; });

  // Solo hacer seed si no hay servicios cargados (primera vez real)
  if(cache.servicios.length === 0) await seedDB();
}

async function refreshFromFirebase() {
  // Corre en background sin bloquear la UI
  try {
    await loadAllFromFirebase();
    saveLocalCache();
    // Si ya hay un usuario logueado, refrescar las vistas
    if(cu) renderAll();
  } catch(e) { console.warn('Background refresh error:', e); }
}

async function seedDB() {
  // Admin inicial — tu email de Google
  const adminId = uid();
  await fsSet('usuarios', adminId, {
    nombre:'Sebastian', email:'rivkin.sebastian@gmail.com', rol:'admin'
  });

  // Empleados
  const emps = [
    {nombre:'Agustin', jornal:30000, color:'#00c4d4'},
    {nombre:'Empleado 2', jornal:20000, color:'#2ecc8a'},
    {nombre:'Empleado 3', jornal:20000, color:'#f0a030'},
    {nombre:'Empleado 4', jornal:20000, color:'#e05555'},
  ];
  for(const e of emps) await fsAdd('empleados', e);

  // Servicios
  const srvs = [
    {nombre:'Moto Común',        cat:'Moto',      tipo:'Común',    precio:7000},
    {nombre:'Moto Premium',      cat:'Moto',      tipo:'Premium',  precio:10000},
    {nombre:'Auto Común',        cat:'Auto',      tipo:'Común',    precio:10000},
    {nombre:'Auto Premium',      cat:'Auto',      tipo:'Premium',  precio:18000},
    {nombre:'SUV Común',         cat:'SUV',       tipo:'Común',    precio:12000},
    {nombre:'SUV Premium',       cat:'SUV',       tipo:'Premium',  precio:20000},
    {nombre:'Camioneta Común',   cat:'Camioneta', tipo:'Común',    precio:14000},
    {nombre:'Camioneta Premium', cat:'Camioneta', tipo:'Premium',  precio:22000},
    {nombre:'Auto Interior',     cat:'Auto',      tipo:'Interior', precio:90000},
    {nombre:'Camioneta Interior',cat:'Camioneta', tipo:'Interior', precio:110000},
    {nombre:'Auto Full',         cat:'Auto',      tipo:'Full',     precio:130000},
    {nombre:'Camioneta Full',    cat:'Camioneta', tipo:'Full',     precio:150000},
  ];
  for(const s of srvs) await fsAdd('servicios', s);

  // Bebidas
  await fsAdd('bebidas', {nombre:'Coca-Cola',      precio:2500, stock:0, alertaMin:6});
  await fsAdd('bebidas', {nombre:'Coca-Cola Zero', precio:2500, stock:0, alertaMin:6});
  await fsAdd('bebidas', {nombre:'Pepsi',          precio:2500, stock:0, alertaMin:6});
  await fsAdd('bebidas', {nombre:'Sprite',         precio:2500, stock:0, alertaMin:6});
  await fsAdd('bebidas', {nombre:'Seven Up',       precio:2500, stock:0, alertaMin:6});
  await fsAdd('bebidas', {nombre:'Agua',           precio:1500, stock:0, alertaMin:6});

  // Recargar cache
  cache.usuarios  = await fsGet('usuarios');
  cache.empleados = await fsGet('empleados');
  cache.servicios = await fsGet('servicios');
  cache.bebidas   = await fsGet('bebidas');
}

// ─── LOGIN / LOGOUT ────────────────────────────────────────────
window.doGoogleLogin = async function() {
  try {
    const result = await auth.signInWithPopup(googleProvider);
    // onAuthStateChanged se encarga del resto
  } catch(e) {
    console.error('Login error:', e);
    if(e.code !== 'auth/popup-closed-by-user') {
      document.getElementById('login-err').style.display = 'block';
    }
  }
};

window.doLogout = async function() {
  if(cu) auditLog('LOGOUT', 'Cierre de sesión');
  await auth.signOut();
  cu = null; selSrv = null;
};

// Firebase Auth observer — se dispara al login y logout automáticamente
auth.onAuthStateChanged(async (firebaseUser) => {
  if(!firebaseUser) {
    // No logueado
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('login-screen').style.display   = 'flex';
    document.getElementById('app-shell').style.display      = 'none';
    document.getElementById('login-err').style.display      = 'none';
    return;
  }

  // Logueado con Google — verificar si tiene acceso
  document.getElementById('loading-screen').style.display = 'flex';
  document.querySelector('.loading-txt').textContent = 'Verificando acceso...';

  // Asegurar que los datos están cargados
  if(cache.usuarios.length === 0) await loadAllFromFirebase();

  const email = firebaseUser.email.toLowerCase();
  const found = cache.usuarios.find(u => u.email && u.email.toLowerCase() === email);

  if(!found) {
    // Email no autorizado
    await auth.signOut();
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('login-screen').style.display   = 'flex';
    document.getElementById('login-err').style.display      = 'block';
    return;
  }

  cu = found;
  document.getElementById('hdr-name').textContent = found.nombre || firebaseUser.displayName || email;
  document.getElementById('hdr-av').textContent   = (found.nombre || firebaseUser.displayName || email).charAt(0).toUpperCase();
  document.getElementById('nav-cfg').style.display = found.rol === 'admin' ? '' : 'none';
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('login-screen').style.display   = 'none';
  document.getElementById('app-shell').style.display      = 'flex';
  auditLog('LOGIN', `${email}`);
  initFields();
  renderAll();
});

function initFields() {
  const h = hoy(), si = semIni(), sf = semFin();
  document.getElementById('reg-fecha').value   = h;
  document.getElementById('reg-filtro').value  = h;
  document.getElementById('cx-fecha').value    = h;
  document.getElementById('adl-fecha').value   = h;
  document.getElementById('cx-f1').value       = `${h.slice(0,7)}-01`;
  document.getElementById('cx-f2').value       = h;
  document.getElementById('sem-ini').value     = si;
  document.getElementById('sem-fin').value     = sf;
  // Resumen por día: semana en curso por defecto
  document.getElementById('resumen-f1').value  = si;
  document.getElementById('resumen-f2').value  = h;
  // Flujo de caja diario: semana en curso por defecto
  document.getElementById('flujo-f1').value    = si;
  document.getElementById('flujo-f2').value    = h;
  // Restaurar última patente usada
  const lastPlate = localStorage.getItem('titan_last_plate');
  if(lastPlate) document.getElementById('reg-patente').value = lastPlate;
  fillAdlEmp();
}

// ─── NAV ───────────────────────────────────────────────────────
window.go = function(id, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('s-'+id).classList.add('active');
  btn.classList.add('active');
  if(id==='dashboard') renderDashboard();
  if(id==='registrar') { renderQGrid(); renderHistorial(); }
  if(id==='caja')      renderCaja();
  if(id==='empleados') renderEmpleados();
  if(id==='stock')     renderStock();
  if(id==='auditoria') renderAudit();
  if(id==='config')    { renderUsers(); renderSrvcfg(); renderBebcfg(); renderEmpcfg(); cargarSaldoEnConfig(); }
};

function renderAll() {
  renderDashboard(); renderQGrid(); renderHistorial();
  renderCaja(); renderEmpleados(); renderAudit();
  renderUsers(); renderSrvcfg(); renderBebcfg(); renderEmpcfg();
}

// ─── DASHBOARD ─────────────────────────────────────────────────
function jornalDevengado(fechaDesde, fechaHasta) {
  let total = 0;
  cache.empleados.forEach(e => {
    const dias = diasEnRango(fechaDesde, fechaHasta);
    const trab = dias.filter(d=>(cache.asistencia[d]||[]).includes(e.id)).length;
    total += trab * e.jornal;
  });
  return total;
}

function renderDashboard() {
  const h=hoy(), si=semIni(), mi=h.slice(0,7)+'-01';
  const cajaOp = cache.caja.filter(c=>c.cat!=='Saldo inicial');

  // Categorías operativas (día a día) vs extraordinarias (gastos del período)
  // Sueldos y adelantos NO cuentan como egreso operativo del día — son cierre semanal
  const CATS_NO_DIARIO = ['Sueldos','Adelanto empleado'];
  const esOper = m => !CATS_NO_DIARIO.includes(m.cat);

  // Ingresos hoy: solo lavados + bebidas (cash real del servicio)
  const ingrH = cajaOp.filter(c=>c.fecha===h&&c.tipo==='ingreso'&&(c.cat==='Lavado'||c.cat==='Bebidas')).reduce((s,c)=>s+c.monto,0);
  // Egresos hoy: jornales devengados según asistencia (costo real del día)
  const egrHOper = cache.empleados.reduce((s,e)=>s+((cache.asistencia[h]||[]).includes(e.id)?e.jornal:0),0);
  // Utilidad operativa del día
  const utilHOper = ingrH - egrHOper;

  // Solo lavados de autos (excluir bebidas)
  const soloLavados    = cache.lavados.filter(l=>l.cat!=='Bebida');
  // Para cálculos financieros: excluir históricos importados (precio=0)
  const lavadosConPrecio = soloLavados.filter(l=>l.precio>0);
  const lavH   = soloLavados.filter(l=>l.fecha===h).length;
  const lavS   = soloLavados.filter(l=>l.fecha>=si&&l.fecha<=h).length;

  // Semana — operativo
  const ingrS     = cajaOp.filter(c=>c.fecha>=si&&c.fecha<=h&&c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const egrSOper  = cajaOp.filter(c=>c.fecha>=si&&c.fecha<=h&&c.tipo==='egreso'&&esOper(c)).reduce((s,c)=>s+c.monto,0);

  // Mes — operativo
  const ingrM     = cajaOp.filter(c=>c.fecha>=mi&&c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const egrMOper  = cajaOp.filter(c=>c.fecha>=mi&&c.tipo==='egreso'&&esOper(c)).reduce((s,c)=>s+c.monto,0);

  // Saldo real en caja — todos los egresos (el saldo sí se ve afectado por todo)
  const saldoBase  = cache.caja.filter(c=>c.cat==='Saldo inicial').reduce((s,c)=>s+c.monto,0);
  const totalIngr  = cajaOp.filter(c=>c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const totalEgr   = cajaOp.filter(c=>c.tipo==='egreso').reduce((s,c)=>s+c.monto,0);
  const saldoTotal = saldoBase + totalIngr - totalEgr;

  // Banner — utilidad operativa (sin gastos extraordinarios)
  document.getElementById('saldo-banner-val').textContent = fmt(saldoTotal);
  document.getElementById('saldo-ingr-hoy').textContent   = fmt(ingrH);
  document.getElementById('saldo-egr-hoy').textContent    = fmt(egrHOper);
  document.getElementById('saldo-util-hoy').textContent   = fmt(utilHOper);
  document.getElementById('saldo-banner').style.background =
    saldoTotal >= 0 ? 'linear-gradient(135deg,#007a88,#00c4d4)' : 'linear-gradient(135deg,#8b2020,#e05555)';

  // Alertas stock
  const alertas = cache.bebidas.filter(b=> b.stock !== undefined && b.alertaMin && b.stock < b.alertaMin);
  const alertDiv = document.getElementById('stock-alerts');
  if(alertas.length > 0) {
    alertDiv.style.display = 'block';
    alertDiv.innerHTML = alertas.map(b=>`
      <div style="display:flex;align-items:center;gap:10px;background:rgba(240,160,48,.12);border:1px solid rgba(240,160,48,.3);border-radius:10px;padding:10px 14px;margin-bottom:6px;">
        <span style="font-size:18px;">⚠️</span>
        <span style="font-size:13px;color:var(--amber);font-weight:500;">Stock bajo: <strong>${b.nombre}</strong> — quedan <strong>${b.stock}</strong> unidades</span>
      </div>`).join('');
  } else { alertDiv.style.display = 'none'; }

  // Promedios — cantidad usa todos los lavados, finanzas solo los que tienen precio
  const diasConLavados  = [...new Set(soloLavados.map(l=>l.fecha))];
  const diasConPrecio   = [...new Set(lavadosConPrecio.map(l=>l.fecha))];
  const totalDias       = Math.max(1, diasConLavados.length);
  const totalDiasFinanc = Math.max(1, diasConPrecio.length);
  const promLavados     = (soloLavados.length / totalDias).toFixed(1);
  const ingrSoloLav     = cache.caja.filter(c=>c.cat==='Lavado'&&c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const promIngr        = Math.round(ingrSoloLav / totalDiasFinanc);
  const totalEgrOper    = cajaOp.filter(c=>c.tipo==='egreso'&&esOper(c)).reduce((s,c)=>s+c.monto,0);
  const promUtil        = Math.round((totalIngr - totalEgrOper) / totalDiasFinanc);
  const conteoSrv       = {};
  soloLavados.forEach(l=>{ conteoSrv[l.servicio]=(conteoSrv[l.servicio]||0)+1; });
  const topSrv          = Object.entries(conteoSrv).sort((a,b)=>b[1]-a[1])[0];
  // Ticket promedio: solo lavados con precio real
  const ticketProm      = lavadosConPrecio.length > 0 ? Math.round(ingrSoloLav / lavadosConPrecio.length) : 0;

  // Empleados: rango seleccionable — descontar lo ya pagado en ese rango
  // Rango empleados: si el valor guardado es de una semana pasada, resetear a la semana actual
  const savedF1 = document.getElementById('dash-emp-f1')?.value;
  const savedF2 = document.getElementById('dash-emp-f2')?.value;
  const empF1 = (savedF1 && savedF1 >= si) ? savedF1 : si;
  const empF2 = (savedF2 && savedF2 >= si) ? savedF2 : semFin();
  const diasEmp = diasEnRango(empF1, empF2);
  let deudaSemana = 0;
  const resEmp = cache.empleados.map(e => {
    const diasTrab  = diasEmp.filter(d=>(cache.asistencia[d]||[]).includes(e.id)).length;
    const bruto     = diasTrab * e.jornal;
    const adlPend   = cache.adelantos.filter(a=>a.empId===e.id&&!a.pagado&&a.fecha>=empF1&&a.fecha<=empF2).reduce((s,a)=>s+a.monto,0);
    // Descontar lo ya pagado por cierre de semana en este rango
    const yaPagado  = (cache.semanasPagadas||[])
      .filter(sp=>sp.f1>=empF1&&sp.f2<=empF2)
      .reduce((s,sp)=>{
        const ep = (sp.empleados||[]).find(x=>x.empId===e.id);
        return s + (ep?ep.neto:0);
      }, 0);
    const neto = bruto - adlPend - yaPagado;
    deudaSemana += Math.max(0, neto);
    return {nombre:e.nombre, diasTrab, bruto, adlPend, yaPagado, neto, color:e.color};
  });

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat"><div class="slbl">Lavados hoy</div><div class="sval c">${lavH}</div></div>
    <div class="stat" style="border-color:var(--cyan)"><div class="slbl">Lavados totales</div><div class="sval c">${soloLavados.length}</div><div style="font-size:10px;color:var(--muted2);margin-top:3px">desde el 16/03</div></div>
    <div class="stat"><div class="slbl">Lavados semana</div><div class="sval c">${lavS}</div></div>
    <div class="stat"><div class="slbl">Ingr. semana</div><div class="sval g">${fmt(ingrS)}</div></div>
    <div class="stat"><div class="slbl">Egr. operativo sem.</div><div class="sval r">${fmt(egrSOper)}</div></div>
    <div class="stat"><div class="slbl">Util. operativa sem.</div><div class="sval ${ingrS-egrSOper>=0?'g':'r'}">${fmt(ingrS-egrSOper)}</div></div>
    <div class="stat"><div class="slbl">Ingr. mes</div><div class="sval g">${fmt(ingrM)}</div></div>
    <div class="stat"><div class="slbl">Util. operativa mes</div><div class="sval ${ingrM-egrMOper>=0?'g':'r'}">${fmt(ingrM-egrMOper)}</div></div>
    <div class="stat"><div class="slbl">Prom. lavados/día</div><div class="sval c">${promLavados}</div></div>
    <div class="stat"><div class="slbl">Prom. ingr. lavados/día</div><div class="sval g">${fmt(promIngr)}</div></div>
    <div class="stat"><div class="slbl">Prom. util. operativa/día</div><div class="sval ${promUtil>=0?'g':'r'}">${fmt(promUtil)}</div></div>
    <div class="stat"><div class="slbl">Ticket prom. lavado</div><div class="sval a">${fmt(ticketProm)}</div></div>
    ${topSrv?`<div class="stat"><div class="slbl">Lavado top</div><div class="sval c" style="font-size:13px;">${topSrv[0]}</div><div style="font-size:10px;color:var(--muted);margin-top:2px">${topSrv[1]} veces</div></div>`:''}
    <div class="stat" style="border-color:var(--amber)"><div class="slbl">A pagar empleados</div><div class="sval a">${fmt(deudaSemana)}</div><div style="font-size:10px;color:var(--muted2);margin-top:2px">rango seleccionado</div></div>
  `;

  // Card empleados — ya existe en el HTML, solo actualizar contenido
  const empCard = document.getElementById('dash-emp-card');
  empCard.innerHTML = `
    <div class="card-hdr">
      <span class="card-title">Empleados — deuda devengada</span>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="date" id="dash-emp-f1" value="${empF1}" oninput="renderDashboard()" style="font-size:12px;padding:5px 8px;width:135px;">
        <span style="color:var(--muted);font-size:12px;">→</span>
        <input type="date" id="dash-emp-f2" value="${empF2}" oninput="renderDashboard()" style="font-size:12px;padding:5px 8px;width:135px;">
      </div>
    </div>
    <div class="tw"><table>
      <thead><tr><th>Empleado</th><th>Días</th><th>Jornal</th><th>Adelantos</th><th>Ya pagado</th><th>Pendiente</th></tr></thead>
      <tbody>
        ${resEmp.map(e=>`<tr>
          <td><div style="display:flex;align-items:center;gap:8px;">
            <div style="width:20px;height:20px;border-radius:50%;background:${e.color}33;color:${e.color};font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">${e.nombre.charAt(0)}</div>
            <span style="font-weight:500">${e.nombre}</span>
          </div></td>
          <td style="color:var(--cyan);font-weight:600">${e.diasTrab}</td>
          <td>${fmt(e.bruto)}</td>
          <td style="color:var(--red)">${e.adlPend>0?'− '+fmt(e.adlPend):'—'}</td>
          <td style="color:var(--green)">${e.yaPagado>0?'− '+fmt(e.yaPagado):'—'}</td>
          <td style="font-weight:700;color:${e.neto>0?'var(--amber)':e.neto===0?'var(--green)':'var(--red)'}">
            ${e.neto>0 ? fmt(e.neto) : e.neto===0 ? '✓ Pagado' : '− '+fmt(Math.abs(e.neto))}
          </td>
        </tr>`).join('')}
        <tr style="background:var(--dark3);border-top:1px solid var(--border2);">
          <td colspan="5" style="font-weight:600;color:var(--muted)">Total pendiente</td>
          <td style="font-weight:700;color:${deudaSemana>0?'var(--amber)':'var(--green)'};font-size:15px">${deudaSemana>0?fmt(deudaSemana):'✓ Todo pagado'}</td>
          <!-- nota: empleados con saldo negativo (a favor del negocio) no reducen este total -->
        </tr>
      </tbody>
    </table></div>
  `;

  // Barras 7 días (ingresos totales, cantidad solo lavados)
  const dias7 = [];
  for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); dias7.push(d.toISOString().split('T')[0]); }
  const vals7 = dias7.map(d => cajaOp.filter(c=>c.fecha===d&&c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0));
  const lav7  = dias7.map(d => soloLavados.filter(l=>l.fecha===d).length);
  const maxV7 = Math.max(...vals7, 1);
  document.getElementById('dash-chart').innerHTML = dias7.map((d,i) => {
    const hh = Math.max(3, Math.round((vals7[i]/maxV7)*90));
    return `<div class="bc-col" onclick="verDetalleDia('${d}')" style="cursor:pointer;" title="Ver detalle de ${fmtDL(d)}">
      <div class="bc-val">${vals7[i]>0?'$'+(vals7[i]/1000).toFixed(0)+'k':''}</div>
      <div class="bc-bar ${i===6?'hoy':''}" style="height:${hh}px;"></div>
      <div class="bc-lbl">${DIAS_S[new Date(d+'T12:00').getDay()]}${lav7[i]>0?'<br>'+lav7[i]:''}</div>
    </div>`;
  }).join('');

  // Últimos movimientos
  const movs = [...cajaOp].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')||0).slice(0,8);
  document.getElementById('dash-mov').innerHTML = movs.length
    ? movs.map(m=>`<tr>
        <td>${fmtD(m.fecha)}</td>
        <td><span class="badge ${m.tipo==='ingreso'?'bg_':'br_'}">${m.tipo}</span></td>
        <td>${m.cat}</td>
        <td style="color:var(--muted)">${m.desc||'—'}</td>
        <td style="color:var(--muted2)">${m.user||'—'}</td>
        <td style="font-weight:700;color:${m.tipo==='ingreso'?'var(--green)':'var(--red)'}">${fmt(m.monto)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="empty">Sin movimientos</td></tr>';

  // Actualizar resumen por día y flujo diario
  renderResumenDias();
  renderFlujoDiario();
}

window.verDetalleDia = function(fecha) {
  const lavsDia  = cache.lavados.filter(l=>l.fecha===fecha).sort((a,b)=>(a.hora||'').localeCompare(b.hora||''));
  const cajaOp   = cache.caja.filter(c=>c.cat!=='Saldo inicial'&&c.fecha===fecha);
  const ingrLav  = cajaOp.filter(c=>c.cat==='Lavado').reduce((s,c)=>s+c.monto,0);
  const ingrBeb  = cajaOp.filter(c=>c.cat==='Bebidas').reduce((s,c)=>s+c.monto,0);
  const egresos  = cajaOp.filter(c=>c.tipo==='egreso');
  const egrCaja  = egresos.reduce((s,c)=>s+c.monto,0);
  // Jornal devengado ese día (virtual — no está en caja a menos que se haya cerrado semana)
  const jDia = cache.empleados.reduce((s,e)=>
    s + ((cache.asistencia[fecha]||[]).includes(e.id) ? e.jornal : 0), 0);
  const totalIngr = ingrLav + ingrBeb;
  const totalEgr  = egrCaja + jDia;

  document.getElementById('dash-dia-titulo').textContent = `Detalle del ${fmtDL(fecha)}`;
  document.getElementById('dash-dia-card').style.display = '';
  document.getElementById('dash-dia-card').scrollIntoView({behavior:'smooth', block:'start'});

  // Tabla ingresos
  document.getElementById('dash-dia-tbody').innerHTML = lavsDia.length
    ? lavsDia.map(l=>`<tr>
        <td>${l.hora||'—'}</td>
        <td><span class="badge bc">${l.servicio}</span></td>
        <td style="color:var(--muted)">${l.cat}</td>
        <td>${l.patente?`<span class="badge ba">${l.patente}</span>`:'—'}</td>
        <td>${l.pago}</td>
        <td style="color:var(--green);font-weight:700">${fmt(l.precio)}</td>
      </tr>`).join('')
      + `<tr class="total-row">
          <td colspan="5" style="color:var(--muted)">Total ingresos</td>
          <td style="color:var(--green)">${fmt(totalIngr)}</td>
        </tr>`
    : '<tr><td colspan="6" class="empty">Sin ingresos este día</td></tr>';

  // Tabla egresos: movimientos reales de caja + jornales devengados
  const filasEgr = egresos.map(e=>`<tr>
    <td><span class="badge br_">${e.cat}</span></td>
    <td style="color:var(--muted)">${e.desc||'—'}</td>
    <td>${e.pago||'—'}</td>
    <td style="color:var(--red);font-weight:700">${fmt(e.monto)}</td>
  </tr>`);

  // Jornales devengados (virtual — mostrar solo si hubo asistencia y no están ya en caja como Sueldos)
  const empConAsistencia = cache.empleados.filter(e=>(cache.asistencia[fecha]||[]).includes(e.id));
  if(empConAsistencia.length) {
    const detJornales = empConAsistencia.map(e=>e.nombre+' '+fmt(e.jornal)).join(', ');
    filasEgr.push(`<tr style="opacity:.7;">
      <td><span class="badge bw">Jornal devengado</span></td>
      <td style="color:var(--muted);font-style:italic">${detJornales}</td>
      <td>—</td>
      <td style="color:var(--red);font-weight:700">${fmt(jDia)}</td>
    </tr>`);
  }

  filasEgr.push(`<tr class="total-row">
    <td colspan="3" style="color:var(--muted)">Total egresos</td>
    <td style="color:var(--red)">${fmt(totalEgr)}</td>
  </tr>`);

  document.getElementById('dash-dia-tbody-egr').innerHTML = filasEgr.length > 1
    ? filasEgr.join('')
    : '<tr><td colspan="4" class="empty">Sin egresos este día</td></tr>';

  // Resumen final
  const resultado = totalIngr - totalEgr;
  document.getElementById('dash-dia-resumen').innerHTML = `
    <div style="font-size:12px;color:var(--muted)">Lavados: <strong style="color:var(--cyan)">${lavsDia.filter(l=>l.cat!=='Bebida').length}</strong></div>
    <div style="font-size:12px;color:var(--muted)">Bebidas: <strong style="color:var(--cyan)">${lavsDia.filter(l=>l.cat==='Bebida').length}</strong></div>
    <div style="font-size:12px;color:var(--muted)">Total ingresos: <strong style="color:var(--green)">${fmt(totalIngr)}</strong></div>
    <div style="font-size:12px;color:var(--muted)">Total egresos: <strong style="color:var(--red)">${fmt(totalEgr)}</strong></div>
    <div style="font-size:13px;font-weight:700;color:${resultado>=0?'var(--green)':'var(--red)'}">Resultado: ${fmt(resultado)}</div>
  `;
};

window.cerrarDetalleDia = function() {
  document.getElementById('dash-dia-card').style.display = 'none';
};

function renderResumenDias() {
  const f1 = document.getElementById('resumen-f1').value;
  const f2 = document.getElementById('resumen-f2').value;
  if(!f1||!f2) return;

  const CATS_EXTR = ['Insumos','Servicios','Impuestos','Otro egreso','Otro ingreso'];
  const dias = [];
  const d = new Date(f1+'T12:00'), end = new Date(f2+'T12:00');
  while(d<=end){ dias.push(d.toISOString().split('T')[0]); d.setDate(d.getDate()+1); }

  const cajaOp = cache.caja.filter(c=>c.cat!=='Saldo inicial');
  const diasActivos = dias.filter(fecha =>
    cache.lavados.some(l=>l.fecha===fecha) || cajaOp.some(c=>c.fecha===fecha)
    || cache.empleados.some(e=>(cache.asistencia[fecha]||[]).includes(e.id))
  ).reverse();

  if(!diasActivos.length) {
    document.getElementById('tbody-resumen-dias').innerHTML = '<tr><td colspan="9" class="empty">Sin actividad en este período</td></tr>';
    return;
  }

  let tLav=0,tILav=0,tBeb=0,tIBeb=0,tEmp=0,tExtr=0,tUtil=0;

  document.getElementById('tbody-resumen-dias').innerHTML = diasActivos.map(fecha => {
    const lavsDia  = cache.lavados.filter(l=>l.fecha===fecha);
    const cDia     = cajaOp.filter(c=>c.fecha===fecha);
    const cantLav  = lavsDia.filter(l=>l.cat!=='Bebida').length;
    const ingrLav  = cDia.filter(c=>c.cat==='Lavado').reduce((s,c)=>s+c.monto,0);
    const cantBeb  = lavsDia.filter(l=>l.cat==='Bebida').length;
    const ingrBeb  = cDia.filter(c=>c.cat==='Bebidas').reduce((s,c)=>s+c.monto,0);
    // Jornal devengado ese día — solo días trabajados × tarifa
    const jDia     = cache.empleados.reduce((s,e)=>
      s + ((cache.asistencia[fecha]||[]).includes(e.id) ? e.jornal : 0), 0);
    // Gastos extraordinarios (insumos, servicios, impuestos, etc.)
    const egrExtr  = cDia.filter(c=>c.tipo==='egreso'&&CATS_EXTR.includes(c.cat)).reduce((s,c)=>s+c.monto,0);
    // Utilidad operativa = ingresos - jornal devengado (sin gastos ext.)
    const util     = ingrLav + ingrBeb - jDia;
    tLav+=cantLav; tILav+=ingrLav; tBeb+=cantBeb; tIBeb+=ingrBeb;
    tEmp+=jDia; tExtr+=egrExtr; tUtil+=util;
    return `<tr style="cursor:pointer;" onclick="verDetalleDia('${fecha}')" title="Ver detalle">
      <td><span style="color:var(--cyan);font-weight:500">${fmtDL(fecha)}</span></td>
      <td>${cantLav}</td>
      <td style="color:var(--green)">${fmt(ingrLav)}</td>
      <td>${cantBeb}</td>
      <td style="color:var(--green)">${fmt(ingrBeb)}</td>
      <td style="color:var(--red)">${jDia>0?fmt(jDia):'—'}</td>
      <td style="color:var(--muted);font-style:italic">${egrExtr>0?fmt(egrExtr):'—'}</td>
      <td style="font-weight:700;color:${util>=0?'var(--green)':'var(--red)'}">${fmt(util)}</td>
    </tr>`;
  }).join('') + `<tr style="background:var(--dark3);font-weight:600;border-top:2px solid var(--border2);">
    <td style="color:var(--muted)">Total</td>
    <td>${tLav}</td><td style="color:var(--green)">${fmt(tILav)}</td>
    <td>${tBeb}</td><td style="color:var(--green)">${fmt(tIBeb)}</td>
    <td style="color:var(--red)">${fmt(tEmp)}</td>
    <td style="color:var(--muted);font-style:italic">${fmt(tExtr)}</td>
    <td style="color:${tUtil>=0?'var(--green)':'var(--red)'};font-weight:700">${fmt(tUtil)}</td>
  </tr>`;
}

// ─── REGISTRAR ─────────────────────────────────────────────────
window.switchTab = function(tab, btn) {
  regTab = tab; selSrv = null;
  document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-lavados').style.display = tab==='lavados' ? '' : 'none';
  document.getElementById('tab-bebidas').style.display = tab==='bebidas' ? '' : 'none';
  document.getElementById('cbar').classList.remove('show');
};

// Orden de categorías y tipos
const CAT_ORDER  = ['Moto','Auto','SUV','Camioneta','Otro'];
const TIPO_ORDER = ['Común','Premium','Interior','Full','—'];

function sortServicios(lista) {
  return [...lista].sort((a,b) => {
    const catA = CAT_ORDER.indexOf(a.cat);
    const catB = CAT_ORDER.indexOf(b.cat);
    if(catA !== catB) return (catA<0?99:catA) - (catB<0?99:catB);
    const tipA = TIPO_ORDER.indexOf(a.tipo);
    const tipB = TIPO_ORDER.indexOf(b.tipo);
    return (tipA<0?99:tipA) - (tipB<0?99:tipB);
  });
}

function renderQGrid() {
  selSrv = null;
  document.getElementById('cbar').classList.remove('show');

  // Agrupar por categoría y mostrar con separadores
  const sorted = sortServicios(cache.servicios);
  let html = '';
  let lastCat = null;
  sorted.forEach(s => {
    if(s.cat !== lastCat) {
      if(lastCat !== null) html += '</div>';
      html += `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:${lastCat?'8px':'0'};margin-bottom:2px;">${ICONS[s.cat]||'⭐'} ${s.cat}</div>`;
      lastCat = s.cat;
    }
    html += `<div class="qbtn" id="q-${s.id}" onclick="selBtn('${s.id}','srv')">
      <div class="qico">${ICONS[s.cat]||'⭐'}</div>
      <div class="qname">${s.nombre}</div>
      <div class="qprice">${fmt(s.precio)}</div>
      <div class="qtype">${s.tipo!=='—'?s.tipo:''}</div>
    </div>`;
  });
  // Botón precio personalizado
  html += `<div style="grid-column:1/-1;font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:8px;margin-bottom:2px;">✏️ Personalizado</div>`;
  html += `<div class="qbtn" id="q-custom" onclick="selCustom()" style="border-style:dashed;border-color:var(--cyan);grid-column:span 2;">
    <div class="qico">✏️</div>
    <div class="qname">Precio personalizado</div>
    <div class="qtype">Elegís vehículo y precio</div>
  </div>`;
  document.getElementById('qgrid-lav').innerHTML = html;

  document.getElementById('qgrid-beb').innerHTML = cache.bebidas.map(b => `
    <div class="qbtn" id="q-${b.id}" onclick="selBtn('${b.id}','beb')">
      <div style="margin-bottom:4px">${bebidaIcon(b.nombre, 36)}</div>
      <div class="qname">${b.nombre}</div>
      <div class="qprice">${fmt(b.precio)}</div>
      ${(b.stock||0) > 0 ? `<div class="qtype">Stock: ${b.stock}</div>` : `<div class="qtype" style="color:var(--red)">Sin stock</div>`}
    </div>`).join('');
}

window.selCustom = function() {
  document.querySelectorAll('.qbtn').forEach(b => b.classList.remove('sel'));
  document.getElementById('q-custom').classList.add('sel');
  selSrv = {_tipo:'custom', nombre:'Precio personalizado', precio:0, cat:'Auto'};
  document.getElementById('cb-nombre').textContent = 'Precio personalizado';
  document.getElementById('cb-precio').textContent = '';
  document.getElementById('cb-cantidad').textContent = '1';
  document.getElementById('cb-total').textContent = '$0';
  document.getElementById('custom-fields').style.display = 'flex';
  document.getElementById('custom-precio').value = '';
  document.getElementById('custom-desc').value = '';
  document.getElementById('cbar').classList.add('show');
  const precioInput = document.getElementById('custom-precio');
  setTimeout(() => precioInput.focus(), 100);
  precioInput.onkeydown = e => { if(e.key === 'Enter') { e.preventDefault(); confirmar(); } };
  document.getElementById('custom-desc').onkeydown = e => { if(e.key === 'Enter') { e.preventDefault(); confirmar(); } };
};

window.actualizarTotalCustom = function() {
  const precio = Number(document.getElementById('custom-precio').value) || 0;
  const cant   = parseInt(document.getElementById('cb-cantidad').textContent) || 1;
  document.getElementById('cb-total').textContent = fmt(precio * cant);
  if(selSrv && selSrv._tipo === 'custom') selSrv.precio = precio;
};

window.selBtn = function(id, tipo) {
  document.querySelectorAll('.qbtn').forEach(b => b.classList.remove('sel'));
  const item = tipo==='srv' ? cache.servicios.find(s=>s.id===id) : cache.bebidas.find(b=>b.id===id);
  if(!item) return;
  selSrv = {...item, _tipo: tipo};
  document.getElementById('q-'+id).classList.add('sel');
  document.getElementById('cb-nombre').textContent = item.nombre;
  document.getElementById('cb-precio').textContent = fmt(item.precio);
  document.getElementById('cb-cantidad').textContent = '1';
  document.getElementById('cb-total').textContent = fmt(item.precio);
  document.getElementById('custom-fields').style.display = 'none';
  document.getElementById('cbar').classList.add('show');
};

window.cambiarCantidad = function(delta) {
  const el = document.getElementById('cb-cantidad');
  let cant = Math.max(1, Math.min(20, parseInt(el.textContent) + delta));
  el.textContent = cant;
  if(selSrv && selSrv._tipo === 'custom') {
    const precio = Number(document.getElementById('custom-precio').value) || 0;
    document.getElementById('cb-total').textContent = fmt(precio * cant);
  } else if(selSrv) {
    document.getElementById('cb-total').textContent = fmt(selSrv.precio * cant);
  }
};

window.confirmar = async function() {
  if(!selSrv) { toast('Seleccioná un servicio','err'); return; }
  const btnC = document.getElementById('btn-confirmar');
  if(btnC && btnC.classList.contains('loading')) return;
  if(btnC) btnC.classList.add('loading');
  const now      = new Date();
  const hora     = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const fechaReg = document.getElementById('reg-fecha').value || hoy();
  const patente  = document.getElementById('reg-patente').value.trim().toUpperCase();
  const pago     = document.getElementById('reg-pago').value;
  const esHoy    = fechaReg === hoy();
  const esBebida = selSrv._tipo === 'beb';
  const esCustom = selSrv._tipo === 'custom';
  const cantidad = parseInt(document.getElementById('cb-cantidad').textContent) || 1;

  // Para precio personalizado, leer campos extra
  if(esCustom) {
    const precioCustom = Number(document.getElementById('custom-precio').value);
    const descCustom   = document.getElementById('custom-desc').value.trim();
    const catCustom    = document.getElementById('custom-cat').value;
    if(!precioCustom) { toast('Ingresá el precio','err'); return; }
    selSrv.precio  = precioCustom;
    selSrv.cat     = catCustom;
    selSrv.nombre  = descCustom || `${catCustom} — precio personalizado`;
  }

  for(let i = 0; i < cantidad; i++) {
    const lv = {fecha:fechaReg, hora:esHoy?hora:'—', servicio:selSrv.nombre,
      cat:esBebida?'Bebida':selSrv.cat, precio:selSrv.precio, patente, pago, user:cu.nombre};
    const lvId = await fsAdd('lavados', lv);
    cache.lavados.push({id:lvId, ...lv});

    const cm = {fecha:fechaReg, tipo:'ingreso', cat:esBebida?'Bebidas':'Lavado',
      desc:`${selSrv.nombre}${patente?' — '+patente:''}${cantidad>1?' ('+cantidad+' unid.)':''}`,
      monto:selSrv.precio, pago, user:cu.nombre};
    const cmId = await fsAdd('caja', cm);
    cache.caja.push({id:cmId, ...cm});
  }

  // Si es bebida, descontar stock
  if(esBebida) {
    const beb = cache.bebidas.find(b=>b.nombre===selSrv.nombre);
    if(beb && beb.stock !== undefined) {
      const nuevoStock = Math.max(0, (beb.stock||0) - cantidad);
      await fsUpdate('bebidas', beb.id, {stock: nuevoStock});
      await registrarStockHist(beb.nombre, -cantidad, nuevoStock);
      beb.stock = nuevoStock;
      if(beb.alertaMin && nuevoStock < beb.alertaMin) {
        setTimeout(()=>toast(`⚠️ Stock bajo de ${beb.nombre}: quedan ${nuevoStock}`, 'warn'), 1500);
      }
    }
  }

  const extra = !esHoy ? ` (${fmtDL(fechaReg)})` : '';
  const cantTxt = cantidad > 1 ? ` x${cantidad}` : '';
  await auditLog(esBebida?'BEBIDA':'SERVICIO',
    `${selSrv.nombre}${cantTxt} — ${fmt(selSrv.precio * cantidad)}${patente?' '+patente:''}${extra}`);

  // Recordar última patente usada
  if(patente) localStorage.setItem('titan_last_plate', patente);

  document.getElementById('reg-filtro').value = fechaReg;
  renderQGrid(); renderHistorial(); renderDashboard();
  document.getElementById('reg-patente').value = '';
  if(btnC) btnC.classList.remove('loading');
  toast(`${selSrv.nombre}${cantTxt}${extra} — ${fmt(selSrv.precio * cantidad)}`, 'ok');
};

function renderHistorial() {
  const fecha = document.getElementById('reg-filtro').value || hoy();
  const lavs  = cache.lavados.filter(l=>l.fecha===fecha).reverse();
  const total = lavs.reduce((s,l)=>s+l.precio,0);
  document.getElementById('tbody-reg').innerHTML = lavs.length
    ? lavs.map(l=>`<tr>
        <td>${l.hora}</td>
        <td><span class="badge bc">${l.servicio}</span></td>
        <td>${l.patente?`<span class="badge ba">${l.patente}</span>`:'—'}</td>
        <td>${l.pago}</td>
        <td style="color:var(--green);font-weight:700">${fmt(l.precio)}</td>
        <td style="color:var(--muted2)">${l.user||'—'}</td>
        <td><button class="btn br" onclick="eliminarLavado('${l.id}','${l.fecha}',${l.precio},'${l.servicio}','${l.patente||''}')">✕</button></td>
      </tr>`).join('') +
      `<tr class="total-row">
        <td colspan="4" style="color:var(--muted);">Total — ${lavs.length} registro${lavs.length!==1?'s':''}</td>
        <td style="color:var(--green)">${fmt(total)}</td>
        <td colspan="2"></td>
      </tr>`
    : '<tr><td colspan="7" class="empty">Sin registros para esta fecha</td></tr>';
}

window.exportarHistorial = function() {
  const fecha = document.getElementById('reg-filtro').value || hoy();
  const lavs  = cache.lavados.filter(l=>l.fecha===fecha).reverse();
  exportCSV(
    ['Hora','Servicio','Patente','Pago','Precio','Operador'],
    lavs.map(l=>[l.hora,l.servicio,l.patente||'',l.pago,l.precio,l.user||'']),
    `historial-${fecha}.csv`
  );
};

window.eliminarLavado = async function(id, fecha, precio, servicio, patente) {
  if(!confirm('¿Eliminar este registro?')) return;
  await fsDel('lavados', id);
  cache.lavados = cache.lavados.filter(l=>l.id!==id);
  // Eliminar caja asociada
  const cm = cache.caja.find(m=>m.tipo==='ingreso'&&m.fecha===fecha&&m.monto===Number(precio)&&(m.desc||'').startsWith(servicio));
  if(cm) { await fsDel('caja', cm.id); cache.caja = cache.caja.filter(m=>m.id!==cm.id); }
  await auditLog('ELIMINAR', `${servicio} — ${fmtDL(fecha)}`);
  renderHistorial(); renderCaja(); renderDashboard(); toast('Eliminado','ok');
};

// ─── CAJA ──────────────────────────────────────────────────────
window.agregarMovExtraord = async function() {
  const monto = Number(document.getElementById('cx-monto').value);
  if(!monto) { toast('Ingresá un monto','err'); return; }
  const mov = {
    fecha: document.getElementById('cx-fecha').value || hoy(),
    tipo: document.getElementById('cx-tipo').value,
    cat:  document.getElementById('cx-cat').value,
    desc: document.getElementById('cx-desc').value.trim(),
    monto, pago:'—', user: cu.nombre
  };
  const id = await fsAdd('caja', mov);
  cache.caja.push({id, ...mov});
  await auditLog('CAJA MANUAL', `${mov.tipo.toUpperCase()} — ${mov.cat} — ${fmt(monto)}`);
  renderCaja(); renderDashboard(); toast('Guardado','ok');
  document.getElementById('cx-monto').value = '';
  document.getElementById('cx-desc').value  = '';
};

function renderCaja() {
  const f1  = document.getElementById('cx-f1').value;
  const f2  = document.getElementById('cx-f2').value;
  const cat = document.getElementById('cx-fcat').value;
  let movs  = [...cache.caja];
  if(f1)  movs = movs.filter(m=>m.fecha>=f1);
  if(f2)  movs = movs.filter(m=>m.fecha<=f2);
  if(cat) movs = movs.filter(m=>m.cat===cat);
  movs.sort((a,b)=>b.fecha?.localeCompare(a.fecha||'')||0);

  const ingr  = movs.filter(m=>m.tipo==='ingreso'&&m.cat!=='Saldo inicial').reduce((s,m)=>s+m.monto,0);
  const egr   = movs.filter(m=>m.tipo==='egreso').reduce((s,m)=>s+m.monto,0);
  const efect = movs.filter(m=>m.tipo==='ingreso'&&m.pago==='Efectivo'&&m.cat!=='Saldo inicial').reduce((s,m)=>s+m.monto,0);
  // Saldo total global siempre (independiente del filtro)
  const saldoBase = cache.caja.filter(c=>c.cat==='Saldo inicial').reduce((s,c)=>s+c.monto,0);
  const cajaOp2   = cache.caja.filter(c=>c.cat!=='Saldo inicial');
  const totalIngr = cajaOp2.filter(c=>c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const totalEgr  = cajaOp2.filter(c=>c.tipo==='egreso').reduce((s,c)=>s+c.monto,0);
  const saldoTotal= saldoBase + totalIngr - totalEgr;

  document.getElementById('caja-stats').innerHTML = `
    <div class="stat"><div class="slbl">Ingresos (filtro)</div><div class="sval g">${fmt(ingr)}</div></div>
    <div class="stat"><div class="slbl">Egresos (filtro)</div><div class="sval r">${fmt(egr)}</div></div>
    <div class="stat"><div class="slbl">Resultado filtro</div><div class="sval ${ingr-egr>=0?'g':'r'}">${fmt(ingr-egr)}</div></div>
    <div class="stat"><div class="slbl">Efectivo ingr.</div><div class="sval a">${fmt(efect)}</div></div>
    <div class="stat" style="border-color:var(--cyan)"><div class="slbl">Saldo total en caja</div><div class="sval ${saldoTotal>=0?'g':'r'}">${fmt(saldoTotal)}</div></div>
  `;
  document.getElementById('tbody-caja').innerHTML = movs.length
    ? movs.map(m=>`<tr>
        <td>${fmtDL(m.fecha)}</td>
        <td><span class="badge ${m.tipo==='ingreso'?'bg_':'br_'}">${m.tipo}</span></td>
        <td>${m.cat}</td>
        <td style="color:var(--muted)">${m.desc||'—'}</td>
        <td style="font-weight:700;color:${m.tipo==='ingreso'?'var(--green)':'var(--red)'}">${fmt(m.monto)}</td>
        <td style="color:var(--muted2)">${m.user||'—'}</td>
        <td><button class="btn br" onclick="eliminarMov('${m.id}')">✕</button></td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty">Sin movimientos en este período</td></tr>';
}

window.eliminarMov = async function(id) {
  if(!confirm('¿Eliminar?')) return;
  const mov = cache.caja.find(m=>m.id===id);
  await fsDel('caja', id);
  cache.caja = cache.caja.filter(m=>m.id!==id);

  // Si era un adelanto, también eliminarlo de la colección adelantos
  if(mov && mov.cat === 'Adelanto empleado') {
    const adl = cache.adelantos.find(a=>
      !a.pagado && a.fecha===mov.fecha && a.monto===mov.monto
    );
    if(adl) {
      await fsDel('adelantos', adl.id);
      cache.adelantos = cache.adelantos.filter(a=>a.id!==adl.id);
    }
  }

  auditLog('ELIMINAR MOV', `${mov?.cat||''} — ${mov?.fecha||id}`);
  renderCaja(); renderEmpleados(); renderDashboard(); toast('Eliminado','ok');
};

window.exportarCaja = function() {
  const f1  = document.getElementById('cx-f1').value;
  const f2  = document.getElementById('cx-f2').value;
  const cat = document.getElementById('cx-fcat').value;
  let movs  = [...cache.caja];
  if(f1)  movs = movs.filter(m=>m.fecha>=f1);
  if(f2)  movs = movs.filter(m=>m.fecha<=f2);
  if(cat) movs = movs.filter(m=>m.cat===cat);
  movs.sort((a,b)=>b.fecha?.localeCompare(a.fecha||'')||0);
  exportCSV(
    ['Fecha','Tipo','Categoría','Descripción','Monto','Usuario'],
    movs.map(m=>[fmtDL(m.fecha),m.tipo,m.cat,m.desc||'',m.monto,m.user||'']),
    `caja-${f1||'todo'}-${f2||'todo'}.csv`
  );
};

window.setRangoCaja = function(rango) {
  const h = hoy();
  if(rango==='hoy')    { document.getElementById('cx-f1').value=h;   document.getElementById('cx-f2').value=h; }
  if(rango==='semana') { document.getElementById('cx-f1').value=semIni(); document.getElementById('cx-f2').value=h; }
  if(rango==='mes')    { document.getElementById('cx-f1').value=h.slice(0,7)+'-01'; document.getElementById('cx-f2').value=h; }
  document.querySelectorAll('.qdate .qd').forEach(b=>b.classList.remove('on'));
  event.target.classList.add('on');
  renderCaja();
};

window.setRangoResumen = function(rango) {
  const h = hoy();
  if(rango==='semana') { document.getElementById('resumen-f1').value=semIni(); document.getElementById('resumen-f2').value=h; }
  if(rango==='mes')    { document.getElementById('resumen-f1').value=h.slice(0,7)+'-01'; document.getElementById('resumen-f2').value=h; }
  if(rango==='todo')   {
    const fechas = cache.lavados.map(l=>l.fecha).concat(cache.caja.map(c=>c.fecha)).filter(Boolean);
    if(fechas.length) { document.getElementById('resumen-f1').value=fechas.reduce((a,b)=>a<b?a:b); document.getElementById('resumen-f2').value=h; }
  }
  document.querySelectorAll('#s-dashboard .qdate .qd').forEach(b=>b.classList.remove('on'));
  event.target.classList.add('on');
  renderResumenDias();
};

window.setRangoFlujo = function(rango) {
  const h = hoy();
  if(rango==='semana') { document.getElementById('flujo-f1').value=semIni(); document.getElementById('flujo-f2').value=h; }
  if(rango==='mes')    { document.getElementById('flujo-f1').value=h.slice(0,7)+'-01'; document.getElementById('flujo-f2').value=h; }
  if(rango==='todo')   {
    const fechas = cache.caja.map(c=>c.fecha).concat(cache.lavados.map(l=>l.fecha)).filter(Boolean);
    if(fechas.length) { document.getElementById('flujo-f1').value=fechas.reduce((a,b)=>a<b?a:b); document.getElementById('flujo-f2').value=h; }
  }
  // highlight active button (solo los del bloque flujo)
  const btns = document.querySelectorAll('#flujo-f1')
    ?.[0]?.closest('.card')?.querySelectorAll('.qd') || [];
  btns.forEach(b=>b.classList.remove('on'));
  event.target.classList.add('on');
  renderFlujoDiario();
};

function renderFlujoDiario() {
  const f1 = document.getElementById('flujo-f1')?.value;
  const f2 = document.getElementById('flujo-f2')?.value;
  if(!f1||!f2) return;

  const cajaAll = cache.caja;
  const saldoBase = cajaAll.filter(c=>c.cat==='Saldo inicial').reduce((s,c)=>s+c.monto,0);
  const cajaOp   = cajaAll.filter(c=>c.cat!=='Saldo inicial');

  // Todos los días del rango
  const dias=[], d=new Date(f1+'T12:00'), end=new Date(f2+'T12:00');
  while(d<=end){ dias.push(d.toISOString().split('T')[0]); d.setDate(d.getDate()+1); }

  // Solo días con actividad
  const diasActivos = dias.filter(fecha=>
    cajaOp.some(c=>c.fecha===fecha) || cache.lavados.some(l=>l.fecha===fecha)
  );

  const tbody = document.getElementById('tbody-flujo');
  if(!diasActivos.length){
    tbody.innerHTML='<tr><td colspan="5" class="empty">Sin actividad en este período</td></tr>';
    return;
  }

  // Precalcular saldo acumulado hasta cada fecha (eficiente: una sola pasada)
  // Ordenar todos los movimientos de caja por fecha
  const allMov = cajaOp.slice().sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||''));

  // Función: saldo acumulado ANTES de la fecha dada
  function saldoAntesDe(fecha) {
    return saldoBase + allMov
      .filter(c=>c.fecha<fecha)
      .reduce((s,c)=>s+(c.tipo==='ingreso'?c.monto:-c.monto),0);
  }

  let tIngresos=0, tEgresos=0;
  const filas = diasActivos.map(fecha=>{
    const cajaDia = cajaOp.filter(c=>c.fecha===fecha);
    // Ingresos mostrados: solo lav + bebidas
    const ingrDia  = cajaDia.filter(c=>c.tipo==='ingreso'&&(c.cat==='Lavado'||c.cat==='Bebidas')).reduce((s,c)=>s+c.monto,0);
    // Egresos: todos los egresos reales (no hay jornales virtuales en caja)
    const egrDia   = cajaDia.filter(c=>c.tipo==='egreso').reduce((s,c)=>s+c.monto,0);
    // Para saldo fin usamos TODOS los ingresos del día (puede haber "Otro ingreso" etc.)
    const ingrDiaAll = cajaDia.filter(c=>c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
    const saldoIni = saldoAntesDe(fecha);
    const saldoFin = saldoIni + ingrDiaAll - egrDia;
    tIngresos+=ingrDia; tEgresos+=egrDia;
    return `<tr onclick="verDetalleDia('${fecha}')" style="cursor:pointer;" title="Ver detalle">
      <td><span style="color:var(--cyan);font-weight:500">${fmtDL(fecha)}</span></td>
      <td style="color:var(--muted)">${fmt(saldoIni)}</td>
      <td style="color:var(--green)">${ingrDia>0?fmt(ingrDia):'—'}</td>
      <td style="color:var(--red)">${egrDia>0?fmt(egrDia):'—'}</td>
      <td style="font-weight:700;color:${saldoFin>=0?'var(--green)':'var(--red)'}">${fmt(saldoFin)}</td>
    </tr>`;
  });

  // Fila de totales
  const saldoFinal = saldoAntesDe(diasActivos[diasActivos.length-1]);
  const cajaDiaFinal = cajaOp.filter(c=>c.fecha===diasActivos[diasActivos.length-1]);
  const ingrFinalAll = cajaDiaFinal.filter(c=>c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const egrFinal     = cajaDiaFinal.filter(c=>c.tipo==='egreso').reduce((s,c)=>s+c.monto,0);
  const saldoFinTotal = saldoFinal + ingrFinalAll - egrFinal;

  tbody.innerHTML = filas.join('') + `
    <tr class="total-row">
      <td style="color:var(--muted)">Total período</td>
      <td style="color:var(--muted)">—</td>
      <td style="color:var(--green)">${fmt(tIngresos)}</td>
      <td style="color:var(--red)">${fmt(tEgresos)}</td>
      <td style="font-weight:700;color:${saldoFinTotal>=0?'var(--green)':'var(--red)'}">${fmt(saldoFinTotal)}</td>
    </tr>`;
}

// ─── EMPLEADOS ─────────────────────────────────────────────────
function fillAdlEmp() {
  document.getElementById('adl-emp').innerHTML =
    cache.empleados.map(e=>`<option value="${e.id}">${e.nombre}</option>`).join('');
}

function diasEnRango(f1,f2) {
  const dias=[], d=new Date(f1+'T12:00'), end=new Date(f2+'T12:00');
  while(d<=end){ dias.push(d.toISOString().split('T')[0]); d.setDate(d.getDate()+1); }
  return dias;
}

function renderEmpleados() {
  const f1   = document.getElementById('sem-ini').value || semIni();
  const f2   = document.getElementById('sem-fin').value || semFin();
  const dias  = diasEnRango(f1,f2);
  const hoyS  = hoy();

  document.getElementById('emp-grid').innerHTML = cache.empleados.map(e => {
    const adlSem   = cache.adelantos.filter(a=>a.empId===e.id&&!a.pagado&&a.fecha>=f1&&a.fecha<=f2);
    const totalAdl = adlSem.reduce((s,a)=>s+a.monto,0);
    const diasTrab = dias.filter(d=>(cache.asistencia[d]||[]).includes(e.id));
    const bruto    = diasTrab.length * e.jornal;
    const neto     = Math.max(0, bruto - totalAdl);

    const diaButtons = dias.map(d => {
      const worked  = (cache.asistencia[d]||[]).includes(e.id);
      const isToday = d === hoyS;
      const label   = DIAS_S[new Date(d+'T12:00').getDay()];
      const dayNum  = new Date(d+'T12:00').getDate();
      return `<button class="dia-btn${worked?' worked':''}${isToday?' today':''}"
        title="${fmtDL(d)}"
        onclick="toggleDia('${e.id}','${d}')">${dayNum}<br><span style="font-size:8px">${label}</span></button>`;
    }).join('');

    return `<div class="ecard">
      <div class="ecard-hdr">
        <div class="eav" style="background:${e.color}22;color:${e.color}">${e.nombre.charAt(0)}</div>
        <div><div style="font-size:14px;font-weight:600;">${e.nombre}</div>
          <div style="font-size:11px;color:var(--muted)">${fmt(e.jornal)}/día</div></div>
      </div>
      <div class="ecard-body">
        <div class="erow"><span style="color:var(--muted);font-size:11px;">Asistencia</span></div>
        <div class="dias-wrap">${diaButtons}</div>
        <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;">
          <div class="erow"><span style="color:var(--muted)">Días</span><span style="color:var(--cyan);font-weight:600">${diasTrab.length}</span></div>
          <div class="erow"><span style="color:var(--muted)">Bruto</span><span>${fmt(bruto)}</span></div>
          <div class="erow"><span style="color:var(--muted)">Adelantos</span><span style="color:var(--red)">${totalAdl>0?'− '+fmt(totalAdl):'—'}</span></div>
        </div>
      </div>
      <div class="ecard-foot">
        <span style="font-size:11px;color:var(--muted)">A cobrar</span>
        <span style="font-size:18px;font-weight:700;color:var(--amber)">${fmt(neto)}</span>
      </div>
    </div>`;
  }).join('');

  // Tabla adelantos
  const adls = [...cache.adelantos].sort((a,b)=>b.fecha?.localeCompare(a.fecha||'')||0);
  document.getElementById('tbody-adl').innerHTML = adls.length
    ? adls.map(a => {
        const e = cache.empleados.find(x=>x.id===a.empId);
        return `<tr>
          <td>${fmtDL(a.fecha)}</td>
          <td style="font-weight:500">${e?.nombre||'—'}</td>
          <td style="color:var(--red);font-weight:600">${fmt(a.monto)}</td>
          <td style="color:var(--muted2)">${a.user||'—'}</td>
          <td><span class="badge ${a.pagado?'bg_':'ba'}">${a.pagado?'Pagado':'Pendiente'}</span></td>
          <td><button class="btn br" onclick="eliminarAdl('${a.id}','${a.empId}','${a.fecha}',${a.monto})">✕</button></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" class="empty">Sin adelantos</td></tr>';
}

window.toggleDia = async function(empId, fecha) {
  if(!cache.asistencia[fecha]) cache.asistencia[fecha] = [];
  const idx = cache.asistencia[fecha].indexOf(empId);
  if(idx>=0) cache.asistencia[fecha].splice(idx,1);
  else       cache.asistencia[fecha].push(empId);
  await fsSet('asistencia', fecha, {empleados: cache.asistencia[fecha]});
  const emp = cache.empleados.find(e=>e.id===empId);
  const presente = cache.asistencia[fecha].includes(empId);
  auditLog('ASISTENCIA', `${emp?.nombre} — ${fmtDL(fecha)} — ${presente?'presente':'ausente'}`);
  renderEmpleados();
  renderDashboard(); // refleja deuda acumulada en tiempo real
};

window.registrarAdelanto = async function() {
  const empId = document.getElementById('adl-emp').value;
  const monto = Number(document.getElementById('adl-monto').value);
  if(!monto) { toast('Ingresá el monto','err'); return; }
  const emp   = cache.empleados.find(e=>e.id===empId);
  const fecha = document.getElementById('adl-fecha').value || hoy();

  const adl  = {empId, fecha, monto, pagado:false, user:cu.nombre};
  const adlId = await fsAdd('adelantos', adl);
  cache.adelantos.push({id:adlId, ...adl});

  // AUTO-CAJA egreso
  const cm = {fecha, tipo:'egreso', cat:'Adelanto empleado',
    desc:`Adelanto a ${emp?.nombre||'empleado'}`, monto, pago:'Efectivo', user:cu.nombre};
  const cmId = await fsAdd('caja', cm);
  cache.caja.push({id:cmId, ...cm});

  await auditLog('ADELANTO', `${emp?.nombre||'?'} — ${fmt(monto)}`);
  renderEmpleados(); renderCaja(); renderDashboard();
  toast(`Adelanto a ${emp?.nombre} — ${fmt(monto)}`, 'ok');
  document.getElementById('adl-monto').value = '';
};

window.eliminarAdl = async function(id, empId, fecha, monto) {
  if(!confirm('¿Eliminar este adelanto?')) return;
  await fsDel('adelantos', id);
  cache.adelantos = cache.adelantos.filter(a=>a.id!==id);
  const cm = cache.caja.find(m=>m.cat==='Adelanto empleado'&&m.fecha===fecha&&m.monto===Number(monto));
  if(cm) { await fsDel('caja', cm.id); cache.caja = cache.caja.filter(m=>m.id!==cm.id); }
  await auditLog('ELIMINAR ADELANTO', id);
  renderEmpleados(); renderCaja(); renderDashboard(); toast('Eliminado','ok');
};

window.cerrarSemana = async function() {
  const f1   = document.getElementById('sem-ini').value || semIni();
  const f2   = document.getElementById('sem-fin').value || semFin();
  const dias  = diasEnRango(f1,f2);
  if(!confirm(`¿Pagar semana del ${fmtDL(f1)} al ${fmtDL(f2)}?`)) return;
  let total = 0;
  const pagosEmpleados = [];
  for(const e of cache.empleados) {
    const diasTrab  = dias.filter(d=>(cache.asistencia[d]||[]).includes(e.id)).length;
    const bruto     = diasTrab * e.jornal;
    const adlsPend  = cache.adelantos.filter(a=>a.empId===e.id&&!a.pagado&&a.fecha>=f1&&a.fecha<=f2);
    const adelantado= adlsPend.reduce((s,a)=>s+a.monto,0);
    const neto      = Math.max(0, bruto - adelantado);
    for(const a of adlsPend) {
      await fsUpdate('adelantos', a.id, {pagado:true});
      const ca = cache.adelantos.find(x=>x.id===a.id);
      if(ca) ca.pagado = true;
    }
    if(neto > 0) {
      const cm = {fecha:hoy(), tipo:'egreso', cat:'Sueldos',
        desc:`Sueldo ${e.nombre} — ${diasTrab} días (${fmtDL(f1)} al ${fmtDL(f2)})`,
        monto:neto, pago:'Efectivo', user:cu.nombre};
      const cmId = await fsAdd('caja', cm);
      cache.caja.push({id:cmId, ...cm});
      total += neto;
    }
    pagosEmpleados.push({empId:e.id, nombre:e.nombre, diasTrab, bruto, adelantado, neto});
  }
  // Guardar semana como pagada para que el dashboard no la cuente como deuda
  const semPagada = {f1, f2, total, fecha:hoy(), user:cu.nombre, empleados:pagosEmpleados};
  const spId = await fsAdd('semanasPagadas', semPagada);
  if(!cache.semanasPagadas) cache.semanasPagadas = [];
  cache.semanasPagadas.push({id:spId, ...semPagada});

  await auditLog('CIERRE SEMANA', `${fmtDL(f1)} al ${fmtDL(f2)} — ${fmt(total)}`);
  renderEmpleados(); renderCaja(); renderDashboard();
  toast(`Semana cerrada — Total: ${fmt(total)}`, 'ok');
};

// ─── AUDITORÍA ─────────────────────────────────────────────────
const _renderAuditInner = debounce(function() {
  fsGet('audit').then(logs => {
    cache.audit = logs.sort((a,b)=>b.ts?.localeCompare(a.ts||'')||0);
    const q = (document.getElementById('audit-q').value||'').toLowerCase();
    const filtered = cache.audit.filter(l=>!q||[l.accion,l.detalle,l.user].join(' ').toLowerCase().includes(q));
    document.getElementById('audit-list').innerHTML = filtered.length
      ? filtered.map(l => {
          const idx   = cache.usuarios.findIndex(u=>u.id===l.userId);
          const color = COLORS[idx>=0?idx%COLORS.length:6];
          const dt    = new Date(l.ts);
          const ds    = fmtDL(dt.toISOString().split('T')[0])+' '+dt.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
          return `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);align-items:flex-start;">
            <div style="min-width:26px;height:26px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;">${(l.user||'?').charAt(0)}</div>
            <div>
              <div style="font-size:12px;line-height:1.5"><strong>${l.user}</strong> — <span style="color:var(--cyan)">${l.accion}</span>${l.detalle?' — '+l.detalle:''}</div>
              <div style="font-size:10px;color:var(--muted2);margin-top:1px">${ds}</div>
            </div>
          </div>`;
        }).join('')
      : '<div class="empty">Sin registros</div>';
  });
}, 200);

function renderAudit() { _renderAuditInner(); }

// ─── CONFIG ────────────────────────────────────────────────────
function renderUsers() {
  document.getElementById('tbody-users').innerHTML = cache.usuarios.map(u=>`<tr>
    <td style="font-weight:500">${u.nombre||'—'}</td>
    <td style="color:var(--muted);font-size:12px">${u.email||'—'}</td>
    <td><span class="badge ${u.rol==='admin'?'bc':'bw'}">${u.rol}</span></td>
    <td>${cache.usuarios.length>1?`<button class="btn br" onclick="eliminarUser('${u.id}')">✕</button>`:''}</td>
  </tr>`).join('');
}

window.crearUsuario = async function() {
  const nombre = document.getElementById('nu-nombre').value.trim();
  const email  = document.getElementById('nu-email').value.trim().toLowerCase();
  if(!nombre||!email) { toast('Completá nombre y email','err'); return; }
  if(!email.includes('@')) { toast('Email inválido','err'); return; }
  if(cache.usuarios.find(u=>u.email&&u.email.toLowerCase()===email)) { toast('Ese email ya existe','err'); return; }
  const data = {nombre, email, rol:document.getElementById('nu-rol').value};
  const id = await fsAdd('usuarios', data);
  cache.usuarios.push({id, ...data});
  auditLog('NUEVO USUARIO', `${nombre} (${email})`);
  renderUsers(); closeM('m-user'); toast('Usuario agregado','ok');
  ['nu-nombre','nu-email'].forEach(i=>document.getElementById(i).value='');
};

window.eliminarUser = async function(id) {
  if(id===cu.id) { toast('No podés eliminarte','err'); return; }
  if(!confirm('¿Eliminar usuario?')) return;
  const u = cache.usuarios.find(x=>x.id===id);
  await fsDel('usuarios', id);
  cache.usuarios = cache.usuarios.filter(x=>x.id!==id);
  await auditLog('ELIMINAR USUARIO', u?.nombre||id);
  renderUsers(); toast('Eliminado','ok');
};

function renderSrvcfg() {
  document.getElementById('cfg-srv').innerHTML = sortServicios(cache.servicios).map(s=>`
    <div class="srv-cfg-card">
      <div style="font-size:18px;margin-bottom:4px">${ICONS[s.cat]||'⭐'}</div>
      <div style="font-size:12px;font-weight:600;margin-bottom:3px">${s.nombre}</div>
      <div style="font-size:15px;color:var(--cyan);font-weight:700">${fmt(s.precio)}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px">${s.tipo!=='—'?s.tipo:''}</div>
      <div style="margin-top:8px"><button class="btn br" onclick="eliminarSrv('${s.id}')">Eliminar</button></div>
    </div>`).join('');
}

window.crearServicio = async function() {
  const nombre = document.getElementById('ns-nombre').value.trim();
  const precio = Number(document.getElementById('ns-precio').value);
  if(!nombre||!precio) { toast('Completá nombre y precio','err'); return; }
  const data = {nombre, precio, cat:document.getElementById('ns-cat').value, tipo:document.getElementById('ns-tipo').value};
  const id = await fsAdd('servicios', data);
  cache.servicios.push({id, ...data});
  await auditLog('NUEVO SERVICIO', `${nombre} — ${fmt(precio)}`);
  renderSrvcfg(); renderQGrid(); closeM('m-srv'); toast('Servicio guardado','ok');
  ['ns-nombre','ns-precio'].forEach(i=>document.getElementById(i).value='');
};

window.eliminarSrv = async function(id) {
  if(!confirm('¿Eliminar?')) return;
  await fsDel('servicios', id);
  cache.servicios = cache.servicios.filter(s=>s.id!==id);
  renderSrvcfg(); renderQGrid(); toast('Eliminado','ok');
};

function fillStockSelects() {
  const opts = cache.bebidas.map(b=>`<option value="${b.id}">${b.nombre} (stock: ${b.stock||0})</option>`).join('');
  ['stock-beb','stock-beb2'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=opts; });
}

function fillStockSelect() { fillStockSelects(); }

function renderBebcfg() {
  document.getElementById('cfg-beb').innerHTML = cache.bebidas.map(b=>{
    const stockBajo = b.alertaMin && (b.stock||0) < b.alertaMin;
    const brand = getBrand(b.nombre);
    return `<div class="srv-cfg-card" style="${stockBajo?'border-color:var(--amber)':''}">
      <div style="margin-bottom:8px">${bebidaIcon(b.nombre, 40)}</div>
      <div style="font-size:12px;font-weight:600;margin-bottom:3px">${b.nombre}</div>
      <div style="font-size:15px;color:var(--cyan);font-weight:700">${fmt(b.precio)}</div>
      <div style="font-size:11px;margin-top:4px;color:${stockBajo?'var(--amber)':'var(--muted)'}">
        Stock: <strong>${b.stock||0}</strong>${b.alertaMin?` (alerta: ${b.alertaMin})`:''}
        ${stockBajo?' ⚠️':''}
      </div>
      <div style="margin-top:8px"><button class="btn br" onclick="eliminarBeb('${b.id}')">Eliminar</button></div>
    </div>`;
  }).join('');
  fillStockSelects();
}

window.crearBebida = async function() {
  const nombre    = document.getElementById('nb-nombre').value.trim();
  const precio    = Number(document.getElementById('nb-precio').value);
  if(!nombre||!precio) { toast('Completá nombre y precio','err'); return; }
  const stock     = Number(document.getElementById('nb-stock').value) || 0;
  const alertaMin = Number(document.getElementById('nb-alerta').value) || 5;
  const id = await fsAdd('bebidas', {nombre, precio, stock, alertaMin});
  cache.bebidas.push({id, nombre, precio, stock, alertaMin});
  auditLog('NUEVA BEBIDA', `${nombre} — ${fmt(precio)} — stock: ${stock}`);
  renderBebcfg(); renderQGrid(); closeM('m-beb'); toast('Bebida guardada','ok');
  ['nb-nombre','nb-precio','nb-stock','nb-alerta'].forEach(i=>document.getElementById(i).value='');
};

window.agregarStock = async function() {
  const bebId = document.getElementById('stock-beb').value;
  const cant  = Number(document.getElementById('stock-cant').value);
  const alerta= Number(document.getElementById('stock-alerta').value);
  if(!bebId||!cant) { toast('Seleccioná bebida y cantidad','err'); return; }
  const beb = cache.bebidas.find(b=>b.id===bebId);
  if(!beb) return;
  const nuevoStock = (beb.stock||0) + cant;
  const update = {stock: nuevoStock};
  if(alerta) update.alertaMin = alerta;
  await fsUpdate('bebidas', bebId, update);
  beb.stock = nuevoStock;
  if(alerta) beb.alertaMin = alerta;
  await registrarStockHist(beb.nombre, cant, nuevoStock);
  auditLog('STOCK BEBIDA', `${beb.nombre} +${cant} → total: ${nuevoStock}`);
  renderBebcfg(); renderDashboard(); toast(`Stock actualizado: ${beb.nombre} = ${nuevoStock}`,'ok');
  document.getElementById('stock-cant').value='';
};

window.eliminarBeb = async function(id) {
  if(!confirm('¿Eliminar?')) return;
  await fsDel('bebidas', id);
  cache.bebidas = cache.bebidas.filter(b=>b.id!==id);
  renderBebcfg(); renderQGrid(); toast('Eliminado','ok');
};

// ─── STOCK PAGE ─────────────────────────────────────────────────
function renderStock() {
  fillStockSelects();

  // Alertas
  const alertas = cache.bebidas.filter(b=>b.alertaMin && (b.stock||0) < b.alertaMin);
  const alertDiv = document.getElementById('stock-alerts-page');
  alertDiv.innerHTML = alertas.length
    ? alertas.map(b=>`<div style="display:flex;align-items:center;gap:10px;background:rgba(240,160,48,.12);border:1px solid rgba(240,160,48,.3);border-radius:10px;padding:10px 14px;margin-bottom:6px;">
        <span style="font-size:18px;">⚠️</span>
        <span style="font-size:13px;color:var(--amber);font-weight:500;">Stock bajo: <strong>${b.nombre}</strong> — quedan <strong>${b.stock}</strong> unidades (alerta: ${b.alertaMin})</span>
      </div>`).join('')
    : '<div style="background:rgba(46,204,138,.08);border:1px solid rgba(46,204,138,.2);border-radius:10px;padding:10px 14px;font-size:13px;color:var(--green);margin-bottom:6px;">✓ Todos los stocks están OK</div>';

  // Cards de bebidas
  document.getElementById('stock-cards-grid').innerHTML = cache.bebidas.map(b => {
    const stock     = b.stock || 0;
    const alertaMin = b.alertaMin || 0;
    const pct       = alertaMin > 0 ? Math.min(100, Math.round(stock / Math.max(alertaMin*3, stock, 1) * 100)) : Math.min(100, stock*10);
    const color     = stock === 0 ? 'var(--red)' : (alertaMin && stock < alertaMin ? 'var(--amber)' : 'var(--green)');
    const vendidas  = cache.lavados.filter(l=>l.cat==='Bebida'&&l.servicio===b.nombre).length;
    const brand     = getBrand(b.nombre);
    return `<div class="card" style="margin:0;border-color:${alertaMin&&stock<alertaMin?'var(--amber)':'var(--border)'}">
      <div class="card-body">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            ${bebidaIcon(b.nombre, 48)}
            <div>
              <div style="font-size:15px;font-weight:600;">${b.nombre}</div>
              <div style="font-size:12px;color:var(--muted)">${fmt(b.precio)} c/u</div>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:36px;font-weight:700;color:${color};line-height:1">${stock}</div>
            <div style="font-size:10px;color:var(--muted)">unidades</div>
          </div>
        </div>
        <div style="background:var(--dark3);border-radius:6px;height:8px;overflow:hidden;margin-bottom:10px;">
          <div style="width:${pct}%;height:100%;background:${brand.bg};border-radius:6px;transition:width .4s;opacity:.85;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);">
          <span>Alerta: <strong style="color:${color}">${alertaMin||'—'}</strong></span>
          <span>Vendidas: <strong style="color:var(--cyan)">${vendidas}</strong></span>
          <span>Ingr. total: <strong style="color:var(--green)">${fmt(vendidas*b.precio)}</strong></span>
        </div>
      </div>
    </div>`;
  }).join('') || '<div class="empty" style="grid-column:1/-1">No hay bebidas cargadas</div>';

  // Historial
  const hist = [...cache.stockHist].sort((a,b)=>(b.ts||'').localeCompare(a.ts||'')).slice(0,50);
  document.getElementById('tbody-stock-hist').innerHTML = hist.length
    ? hist.map(h=>{
        const dt = new Date(h.ts);
        const ds = fmtDL(dt.toISOString().split('T')[0])+' '+dt.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
        const esIngreso = h.delta > 0;
        return `<tr>
          <td style="color:var(--muted2)">${ds}</td>
          <td style="font-weight:500">${h.bebida}</td>
          <td style="color:${esIngreso?'var(--green)':'var(--red)'};font-weight:600">${esIngreso?'+':''}${h.delta}</td>
          <td>${h.stockResultante}</td>
          <td style="color:var(--muted2)">${h.user||'—'}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="empty">Sin movimientos de stock</td></tr>';
}

async function registrarStockHist(bebida, delta, stockResultante) {
  const entry = {ts:new Date().toISOString(), bebida, delta, stockResultante, user:cu.nombre};
  const id = await fsAdd('stockHist', entry);
  cache.stockHist.push({id, ...entry});
}

window.agregarStock2 = async function() {
  const bebId  = document.getElementById('stock-beb2').value;
  const cant   = Number(document.getElementById('stock-cant2').value);
  const alerta = Number(document.getElementById('stock-alerta2').value);
  if(!bebId||!cant) { toast('Seleccioná bebida y cantidad','err'); return; }
  const beb = cache.bebidas.find(b=>b.id===bebId);
  if(!beb) return;
  const nuevoStock = (beb.stock||0) + cant;
  const update = {stock: nuevoStock};
  if(alerta) update.alertaMin = alerta;
  await fsUpdate('bebidas', bebId, update);
  beb.stock = nuevoStock;
  if(alerta) beb.alertaMin = alerta;
  await registrarStockHist(beb.nombre, cant, nuevoStock);
  auditLog('STOCK +', `${beb.nombre} +${cant} → ${nuevoStock}`);
  renderStock(); renderBebcfg(); renderDashboard();
  toast(`${beb.nombre}: +${cant} → stock total: ${nuevoStock}`, 'ok');
  document.getElementById('stock-cant2').value='';
};

function renderEmpcfg() {
  document.getElementById('tbody-empcfg').innerHTML = cache.empleados.map(e=>`<tr>
    <td style="font-weight:500">${e.nombre}</td>
    <td style="color:var(--amber)">${fmt(e.jornal)}</td>
    <td><button class="btn br" onclick="eliminarEmp('${e.id}')">✕</button></td>
  </tr>`).join('');
}

window.crearEmpleado = async function() {
  const nombre = document.getElementById('ne-nombre').value.trim();
  const jornal = Number(document.getElementById('ne-jornal').value);
  if(!nombre||!jornal) { toast('Completá nombre y jornal','err'); return; }
  const color = COLORS[cache.empleados.length % COLORS.length];
  const id = await fsAdd('empleados', {nombre, jornal, color});
  cache.empleados.push({id, nombre, jornal, color});
  await auditLog('NUEVO EMPLEADO', `${nombre} — ${fmt(jornal)}/día`);
  renderEmpcfg(); renderEmpleados(); fillAdlEmp(); closeM('m-emp'); toast('Empleado agregado','ok');
  ['ne-nombre','ne-jornal'].forEach(i=>document.getElementById(i).value='');
};

window.guardarSaldoInicial = async function() {
  const monto = Number(document.getElementById('cfg-saldo').value);
  const fecha = document.getElementById('cfg-saldo-fecha').value || hoy();
  if(!monto) { toast('Ingresá un monto','err'); return; }

  // Buscar si ya existe un saldo inicial y eliminarlo
  const existing = cache.caja.find(m=>m.cat==='Saldo inicial');
  if(existing) {
    await fsDel('caja', existing.id);
    cache.caja = cache.caja.filter(m=>m.id!==existing.id);
  }

  // Guardar nuevo saldo
  const mov = {fecha, tipo:'ingreso', cat:'Saldo inicial',
    desc:'Saldo inicial de caja', monto, pago:'—', user:cu.nombre};
  const id = await fsAdd('caja', mov);
  cache.caja.push({id, ...mov});

  await auditLog('SALDO INICIAL', `${fmt(monto)} — ${fmtDL(fecha)}`);
  document.getElementById('saldo-actual-wrap').style.display = 'block';
  document.getElementById('saldo-actual-txt').textContent = fmt(monto) + ' al ' + fmtDL(fecha);
  renderCaja(); renderDashboard();
  toast('Saldo inicial guardado','ok');
};

function cargarSaldoEnConfig() {
  const existing = cache.caja.find(m=>m.cat==='Saldo inicial');
  if(existing) {
    document.getElementById('cfg-saldo').value = existing.monto;
    document.getElementById('cfg-saldo-fecha').value = existing.fecha;
    document.getElementById('saldo-actual-wrap').style.display = 'block';
    document.getElementById('saldo-actual-txt').textContent = fmt(existing.monto) + ' al ' + fmtDL(existing.fecha);
  }
}

window.eliminarEmp = async function(id) {
  if(!confirm('¿Eliminar empleado?')) return;
  const e = cache.empleados.find(x=>x.id===id);
  await fsDel('empleados', id);
  cache.empleados = cache.empleados.filter(x=>x.id!==id);
  auditLog('ELIMINAR EMPLEADO', e?.nombre||id);
  renderEmpcfg(); renderEmpleados(); fillAdlEmp(); toast('Eliminado','ok');
};

// ─── MODAL / TOAST ─────────────────────────────────────────────
window.openM = id => {
  const modal = document.getElementById(id);
  modal.classList.add('open');
  setTimeout(() => { const first = modal.querySelector('input,select'); if(first) first.focus(); }, 60);
};
window.closeM = id => document.getElementById(id).classList.remove('open');
document.addEventListener('click', e => { if(e.target.classList.contains('modal-bg')) e.target.classList.remove('open'); });
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') document.querySelectorAll('.modal-bg.open').forEach(m => m.classList.remove('open'));
  if(e.key === 'Enter' && !['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.target.tagName) && selSrv) confirmar();
});

let _tt;
window.toast = function(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast show ${type}`;
  clearTimeout(_tt); _tt = setTimeout(()=>el.classList.remove('show'), 3200);
};

// ─── DEV BYPASS (solo localhost / file://) ─────────────────────
const isDev = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
if(isDev) {
  // Mostrar botón de bypass en login
  auth.onAuthStateChanged(u => {
    if(!u) document.getElementById('dev-bypass-wrap').style.display = 'block';
  });
}

window.devLogin = async function() {
  document.getElementById('loading-screen').style.display = 'flex';
  document.querySelector('.loading-txt').textContent = 'Cargando datos...';
  try {
    if(cache.usuarios.length === 0) await loadAllFromFirebase();
  } catch(e) {
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('login-screen').style.display   = 'flex';
    alert('No se pudo conectar a Firestore.\n\nPosibles causas:\n1. Las reglas de Firestore requieren autenticación.\n   → Cambiá las reglas a: allow read, write: if true;\n2. Sin conexión a internet.');
    return;
  }
  const adminUser = cache.usuarios.find(u => u.rol === 'admin') || cache.usuarios[0];
  if(!adminUser) {
    document.getElementById('loading-screen').style.display = 'none';
    alert('No hay usuarios en la base. Revisá la conexión a Firebase.');
    return;
  }
  cu = adminUser;
  document.getElementById('hdr-name').textContent = adminUser.nombre + ' (dev)';
  document.getElementById('hdr-av').textContent   = adminUser.nombre.charAt(0).toUpperCase();
  document.getElementById('nav-cfg').style.display = adminUser.rol === 'admin' ? '' : 'none';
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('login-screen').style.display   = 'none';
  document.getElementById('app-shell').style.display      = 'flex';
  initFields();
  renderAll();
};

// ─── ARRANCAR ──────────────────────────────────────────────────
initApp();
