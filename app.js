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

// ─── SEGURIDAD ─────────────────────────────────────────────────
/** Escapa HTML para uso seguro en innerHTML — previene XSS */
function sanitize(str) {
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\//g,'&#x2F;');
}

/** Rate limiting client-side — max N writes por minuto por clave */
const _rl = {};
function checkRateLimit(key, max=20) {
  const min = Math.floor(Date.now()/60000);
  const k   = `${key}_${min}`;
  _rl[k]    = (_rl[k]||0) + 1;
  // limpiar claves viejas
  Object.keys(_rl).forEach(x=>{ if(!x.endsWith('_'+min)) delete _rl[x]; });
  if(_rl[k] > max) { toast('Demasiadas operaciones en poco tiempo — esperá un momento','warn'); return false; }
  return true;
}

/** Verifica que el usuario logueado tenga rol admin */
function requireAdmin() {
  if(!cu || cu.rol !== 'admin') { toast('Solo administradores pueden hacer eso','err'); return false; }
  return true;
}

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
  const safe = (nombre || '').toString();
  const key  = safe.toLowerCase().trim();
  for(const [k, v] of Object.entries(BEBIDA_BRAND)) {
    if(key && key.includes(k)) return v;
  }
  return {bg:'#444', text:'#fff', inicial: (safe.charAt(0) || '?').toUpperCase(), borde:'#333'};
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
// Días de la semana excluidos del promedio mensual (análisis "qué pasaría si")
let _dowExcl = new Set(JSON.parse(localStorage.getItem('titan_dow_excl') || '[]'));

// Cache local (se actualiza con onSnapshot)
let cache = {
  usuarios: [], empleados: [], servicios: [], bebidas: [],
  lavados: [], caja: [], adelantos: [], asistencia: {}, audit: [],
  stockHist: [], semanasPagadas: [], costosFijos: []
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
const CACHE_TTL = 90 * 1000; // 90 segundos — reduce datos stale entre sesiones

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
  const [usuarios, empleados, servicios, bebidas, lavados, caja, adelantos, asistSnap, stockHist, semanasPagadas, costosFijos] = await Promise.all([
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
    db.collection('costosFijos').get(),
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
  cache.costosFijos    = costosFijos.docs.map(d=>({id:d.id,...d.data()}));
  cache.asistencia = {};
  asistSnap.docs.forEach(d => { cache.asistencia[d.id] = d.data().empleados || []; });

  // Solo hacer seed si no hay servicios cargados (primera vez real)
  if(cache.servicios.length === 0) await seedDB();
}

// Refresca solo las colecciones que cambian en tiempo real entre sesiones
async function refreshCritical() {
  try {
    const [sp, adl, asist, caja] = await Promise.all([
      db.collection('semanasPagadas').get(),
      db.collection('adelantos').get(),
      db.collection('asistencia').get(),
      db.collection('caja').get(),
    ]);
    cache.semanasPagadas = sp.docs.map(d=>({id:d.id,...d.data()}));
    cache.adelantos      = adl.docs.map(d=>({id:d.id,...d.data()}));
    cache.caja           = caja.docs.map(d=>({id:d.id,...d.data()}));
    cache.asistencia = {};
    asist.docs.forEach(d=>{ cache.asistencia[d.id] = d.data().empleados||[]; });
    saveLocalCache();
  } catch(e) { console.warn('refreshCritical error:', e); }
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
  try {
    if(cache.usuarios.length === 0) await loadAllFromFirebase();
  } catch(e) {
    // PERMISSION_DENIED = cuenta de Google no autorizada en Firestore Rules
    if(e.code === 'permission-denied' || (e.message||'').toLowerCase().includes('permission')) {
      await auth.signOut();
      document.getElementById('loading-screen').style.display = 'none';
      document.getElementById('login-screen').style.display   = 'flex';
      document.getElementById('login-err').style.display      = 'block';
      return;
    }
    // Otro error real (sin conexión, etc.)
    console.error('Error cargando datos de Firebase:', e);
    document.querySelector('.loading-txt').textContent = 'Error al conectar. Verificá tu conexión a internet.';
    return;
  }

  const email = firebaseUser.email.toLowerCase().trim();
  const found = cache.usuarios.find(u => u.email && u.email.toLowerCase().trim() === email);

  console.log('Login intent:', email, '| usuarios cargados:', cache.usuarios.length, '| encontrado:', !!found);
  if(!found) console.warn('Emails en sistema:', cache.usuarios.map(u=>u.email));

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

  // Auto-inicializar allowlist si es admin y todavía no existe.
  // Esto corre silenciosamente en background — la app ya está cargada.
  if(found.rol === 'admin') {
    db.collection('config').doc('allowlist').get().then(snap => {
      if(!snap.exists) {
        const emails = {};
        cache.usuarios.forEach(u => {
          if(u.email) emails[u.email.toLowerCase().trim()] = u.rol || 'user';
        });
        db.collection('config').doc('allowlist').set({ emails })
          .then(() => console.log('[Security] Allowlist inicializada con', Object.keys(emails).length, 'usuarios'))
          .catch(e => console.error('[Security] Error inicializando allowlist:', e));
      }
    }).catch(e => console.warn('[Security] No se pudo verificar allowlist:', e));
  }
});

function initFields() {
  const h = hoy(), si = semIni(), sf = semFin();
  document.getElementById('reg-fecha').value   = h;
  document.getElementById('hist-f1').value     = h;
  document.getElementById('hist-f2').value     = h;
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
  if(id==='dashboard') {
    renderDashboard();
    // Siempre refrescar datos en tiempo real al entrar al dashboard
    refreshCritical().then(()=>{ if(cu) renderDashboard(); });
  }
  if(id==='registrar') { renderQGrid(); renderHistorial(); }
  if(id==='caja')      renderCaja();
  if(id==='empleados') {
    renderEmpleados(); // render inmediato con lo que hay
    // Luego refresca las colecciones críticas desde Firestore
    refreshCritical().then(()=>{ if(cu) renderEmpleados(); });
  }
  if(id==='stock')     renderStock();
  if(id==='auditoria') renderAudit();
  if(id==='costos')    renderCostosFijos();
  if(id==='recibos')   renderRecibos();
  if(id==='config')    {
    // Cada render aislado: si uno falla, los demás igual se ejecutan
    [renderUsers, renderSrvcfg, renderBebcfg, renderEmpcfg, cargarSaldoEnConfig]
      .forEach(fn=>{ try { fn(); } catch(e){ console.error('Error en', fn.name, e); } });
  }
};

function renderAll() {
  renderDashboard(); renderQGrid(); renderHistorial();
  renderCaja(); renderEmpleados(); renderAudit();
  renderUsers(); renderSrvcfg(); renderBebcfg(); renderEmpcfg();
  renderCostosFijos();
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

// ─── COSTOS FIJOS ──────────────────────────────────────────────
function renderCostosFijos() {
  const costos  = cache.costosFijos || [];
  const mi      = hoy().slice(0,7) + '-01'; // primer día del mes actual

  // Para cada costo fijo, buscar pagos reales vinculados en Caja
  // y calcular monto efectivo (promedio mensual real si hay datos, sino el configurado)
  const costosConReal = costos.map(c => {
    const pagos = cache.caja.filter(m=>m.costoFijoId===c.id&&m.tipo==='egreso');
    // Promedio mensual real: agrupar por mes y promediar
    const porMes = {};
    pagos.forEach(p=>{ const m=p.fecha.slice(0,7); porMes[m]=(porMes[m]||0)+p.monto; });
    const meses    = Object.values(porMes);
    const promReal = meses.length > 0 ? Math.round(meses.reduce((s,v)=>s+v,0)/meses.length) : null;
    const esteMes  = pagos.filter(p=>p.fecha>=mi).reduce((s,p)=>s+p.monto,0);
    const ultPago  = pagos.sort((a,b)=>b.fecha.localeCompare(a.fecha))[0];
    return {...c, pagos, promReal, esteMes, ultPago};
  });

  // Total usando promedio real cuando disponible, monto configurado si no
  const totalCF = costosConReal.reduce((s,c)=>s+(c.promReal ?? c.monto),0);

  // Ticket promedio de lavado
  const lavadosConPrecio = cache.lavados.filter(l=>l.cat!=='Bebida'&&l.precio>0);
  const ingrSoloLav = cache.caja.filter(c=>c.cat==='Lavado'&&c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const ticketProm  = lavadosConPrecio.length > 0 ? Math.round(ingrSoloLav/lavadosConPrecio.length) : 0;

  // Días abiertos = lavados registrados ∪ asistencia de empleados
  // (igual criterio que en renderDashboard — incluye período importado del Excel)
  const _lavFechas  = new Set(cache.lavados.filter(l=>l.cat!=='Bebida').map(l=>l.fecha));
  const _asistFechas= new Set(Object.keys(cache.asistencia).filter(d=>(cache.asistencia[d]||[]).length>0));
  const diasAb      = [...new Set([..._lavFechas, ..._asistFechas])];
  const mesesAb     = [...new Set(diasAb.map(d=>d.slice(0,7)))];
  const DIAS_MES    = mesesAb.length > 0 ? Math.round(diasAb.length / mesesAb.length) : 26;

  // Sueldos mensuales estimados: suma de jornales × días abiertos promedio por mes
  const sueldosMes = cache.empleados.reduce((s,e)=>s+e.jornal,0) * DIAS_MES;
  const costoTotal = totalCF + sueldosMes;

  // Punto de equilibrio
  const beCF     = ticketProm > 0 ? Math.ceil(totalCF   / ticketProm) : 0;
  const beTotal  = ticketProm > 0 ? Math.ceil(costoTotal / ticketProm) : 0;
  const beCFDia  = ticketProm > 0 ? Math.ceil(totalCF   / DIAS_MES / ticketProm) : 0;
  const beTotDia = ticketProm > 0 ? Math.ceil(costoTotal / DIAS_MES / ticketProm) : 0;

  // Panel análisis
  const analisisEl = document.getElementById('costos-analisis');
  if(analisisEl) analisisEl.innerHTML = totalCF > 0 && ticketProm > 0 ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:12px;margin-bottom:1.25rem;">
      <div class="stat" style="border-color:var(--red)">
        <div class="slbl">Costos fijos/mes</div>
        <div class="sval r">${fmt(totalCF)}</div>
        <div style="font-size:10px;color:var(--muted2);margin-top:2px">promedio real donde hay datos</div>
      </div>
      <div class="stat" style="border-color:var(--amber)">
        <div class="slbl">Sueldos estimados/mes</div>
        <div class="sval a">${fmt(sueldosMes)}</div>
        <div style="font-size:10px;color:var(--muted2);margin-top:2px">${cache.empleados.length} empl. × ${DIAS_MES} días/mes</div>
      </div>
      <div class="stat" style="border-color:var(--red)">
        <div class="slbl">Costo total mensual</div>
        <div class="sval r">${fmt(costoTotal)}</div>
      </div>
      <div class="stat">
        <div class="slbl">Ticket prom. lavado</div>
        <div class="sval c">${fmt(ticketProm)}</div>
        <div style="font-size:10px;color:var(--muted2);margin-top:2px">promedio histórico</div>
      </div>
      <div class="stat" style="border-color:var(--cyan)">
        <div class="slbl">🚗 Autos para cubrir fijos</div>
        <div class="sval c">${beCF}/mes</div>
        <div style="font-size:10px;color:var(--muted2);margin-top:2px">${beCFDia} por día</div>
      </div>
      <div class="stat" style="border-color:#a78bfa">
        <div class="slbl">🚗 Autos para cubrir todo</div>
        <div class="sval" style="color:#a78bfa">${beTotal}/mes</div>
        <div style="font-size:10px;color:var(--muted2);margin-top:2px">${beTotDia} por día (+ sueldos)</div>
      </div>
    </div>
  ` : `<div style="background:var(--dark2);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:1.25rem;font-size:13px;color:var(--muted);text-align:center;">
    ${costos.length === 0 ? 'Agregá costos fijos para ver el análisis de punto de equilibrio.' : 'Aún no hay lavados registrados con precio para calcular el ticket promedio.'}
  </div>`;

  // Tabla con datos reales
  const cats = [...new Set(costosConReal.map(c=>c.categoria))].sort();
  const filas = cats.flatMap(cat => {
    const delCat   = costosConReal.filter(c=>c.categoria===cat);
    const subTotal = delCat.reduce((s,c)=>s+(c.promReal??c.monto),0);
    return [
      ...delCat.map(c=>{
        const montoMostrar = c.promReal ?? c.monto;
        const tieneReal    = c.promReal !== null;
        const ultFecha     = c.ultPago ? fmtDL(c.ultPago.fecha) : '—';
        return `<tr>
          <td style="font-weight:500">${c.nombre}</td>
          <td style="color:var(--muted)">${c.categoria}</td>
          <td style="font-weight:700;color:var(--red)">${fmt(montoMostrar)}
            ${tieneReal
              ? `<div style="font-size:10px;color:var(--green);margin-top:1px">✓ real · conf: ${fmt(c.monto)}</div>`
              : `<div style="font-size:10px;color:var(--muted2);margin-top:1px">estimado — sin pagos aún</div>`}
          </td>
          <td style="font-size:11px;color:var(--muted2)">
            ${c.esteMes > 0 ? `Este mes: ${fmt(c.esteMes)}<br>` : ''}
            ${tieneReal ? `Último: ${ultFecha}` : ''}
          </td>
          <td style="display:flex;gap:6px;align-items:center;">
            <button class="btn bp" style="font-size:11px;padding:4px 10px;" onclick="pagarCostoFijo('${c.id}')">💳 Pagar</button>
            <button class="btn br" onclick="eliminarCostoFijo('${c.id}')">✕</button>
          </td>
        </tr>`;
      }),
      `<tr style="background:var(--dark3);">
        <td colspan="3" style="font-size:11px;color:var(--muted2);padding-left:14px;">Subtotal ${cat}</td>
        <td colspan="2" style="font-size:11px;color:var(--muted);font-weight:600;">${fmt(subTotal)}</td>
      </tr>`
    ];
  });
  if(costos.length > 0) filas.push(`<tr style="background:var(--dark3);border-top:2px solid var(--border2);">
    <td colspan="3" style="font-weight:700;color:var(--text)">TOTAL MENSUAL</td>
    <td colspan="2" style="font-weight:800;color:var(--red);font-size:16px">${fmt(totalCF)}</td>
  </tr>`);

  const tbodyCostos = document.getElementById('tbody-costos');
  if(tbodyCostos) tbodyCostos.innerHTML = filas.length
    ? filas.join('')
    : '<tr><td colspan="5" class="empty">Sin costos registrados. Agregá el primero arriba.</td></tr>';
}

window.agregarCostoFijo = async function() {
  const nombre = document.getElementById('cf-nombre').value.trim();
  const monto  = Number(document.getElementById('cf-monto').value);
  const cat    = document.getElementById('cf-cat').value;
  if(!nombre) { toast('Ingresá un nombre','err'); return; }
  if(!monto)  { toast('Ingresá un monto','err'); return; }
  const btn = document.getElementById('btn-add-costo');
  if(btn) btn.disabled = true;
  try {
    // 1. Guardar el costo fijo
    const costo = {nombre, categoria:cat, monto};
    const cfId  = await fsAdd('costosFijos', costo);
    cache.costosFijos.push({id:cfId, ...costo});
    // 2. Crear el egreso en Caja
    const mov = {
      fecha: hoy(), tipo:'egreso', cat:'Costos fijos',
      desc: nombre, monto, pago:'—',
      costoFijoId: cfId, user: cu?.nombre || '—'
    };
    const cajId = await fsAdd('caja', mov);
    cache.caja.push({id:cajId, ...mov});
    await auditLog('COSTO FIJO', `${nombre} — ${fmt(monto)}/mes`);
    renderCostosFijos(); renderCaja(); renderDashboard();
    toast('Costo guardado y descontado de caja ✓','ok');
    document.getElementById('cf-nombre').value = '';
    document.getElementById('cf-monto').value  = '';
  } catch(e) {
    console.error('Error al guardar costo fijo:', e);
    toast('Error al guardar. Revisá la consola.','err');
  } finally {
    if(btn) btn.disabled = false;
  }
};


window.pagarCostoFijo = async function(cfId) {
  const cf = cache.costosFijos.find(c=>c.id===cfId);
  if(!cf) return;
  const montoStr = prompt(`Monto a pagar para "${cf.nombre}"\n(Presioná Enter para usar ${fmt(cf.monto)}):`, cf.monto);
  if(montoStr === null) return; // canceló
  const monto = Number(montoStr) || cf.monto;
  try {
    const mov = {
      fecha: hoy(), tipo:'egreso', cat:'Costos fijos',
      desc: cf.nombre, monto, pago:'—',
      costoFijoId: cfId, user: cu?.nombre || '—'
    };
    const cajId = await fsAdd('caja', mov);
    cache.caja.push({id:cajId, ...mov});
    await auditLog('PAGO COSTO FIJO', `${cf.nombre} — ${fmt(monto)}`);
    renderCostosFijos(); renderCaja(); renderDashboard();
    toast(`Pago de ${cf.nombre} registrado ✓`, 'ok');
  } catch(e) {
    console.error('Error al registrar pago:', e);
    toast('Error al registrar el pago.','err');
  }
};

window.eliminarCostoFijo = async function(id) {
  if(!confirm('¿Eliminar este costo fijo?')) return;
  await fsDel('costosFijos', id);
  cache.costosFijos = cache.costosFijos.filter(c=>c.id!==id);
  renderCostosFijos();
  renderDashboard();
  toast('Eliminado','ok');
};

function renderDashboard() {
  const h=hoy(), si=semIni(), mi=h.slice(0,7)+'-01';
  const cajaOp = cache.caja.filter(c=>c.cat!=='Saldo inicial');

  // Categorías operativas (día a día) vs extraordinarias (gastos del período)
  // Sueldos y adelantos NO cuentan como egreso operativo del día — son cierre semanal
  const CATS_NO_DIARIO = ['Sueldos','Adelanto empleado','Extracción dueños'];
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
  const saldoBase       = cache.caja.filter(c=>c.cat==='Saldo inicial').reduce((s,c)=>s+c.monto,0);
  const totalIngr       = cajaOp.filter(c=>c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const totalEgr        = cajaOp.filter(c=>c.tipo==='egreso').reduce((s,c)=>s+c.monto,0);
  const saldoTotal      = saldoBase + totalIngr - totalEgr;
  const totalExtracciones = cajaOp.filter(c=>c.cat==='Extracción dueños').reduce((s,c)=>s+c.monto,0);

  // Desglose efectivo / transferencia
  // Los egresos (sueldos, adelantos, gastos) siempre salen de efectivo
  const ingrEfect  = cajaOp.filter(c=>c.tipo==='ingreso'&&c.pago==='Efectivo').reduce((s,c)=>s+c.monto,0);
  const ingrTransf = cajaOp.filter(c=>c.tipo==='ingreso'&&c.pago!=='Efectivo'&&c.pago).reduce((s,c)=>s+c.monto,0);
  const saldoEfect = saldoBase + ingrEfect - totalEgr;
  const saldoTransf = ingrTransf;

  // Banner — utilidad operativa (sin gastos extraordinarios)
  document.getElementById('saldo-banner-val').textContent = fmt(saldoTotal);
  document.getElementById('saldo-efect').textContent      = fmt(saldoEfect);
  document.getElementById('saldo-transf').textContent     = fmt(saldoTransf);
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

  // Días abiertos = días con lavados registrados OR con asistencia de empleados.
  // El período 16/03-19/04 fue importado desde Excel (hay lavados pero no asistencia),
  // por eso usamos la UNIÓN de ambos conjuntos como proxy de "el negocio estuvo abierto".
  const diasConLavados2   = new Set(soloLavados.map(l=>l.fecha));
  const diasConAsist      = new Set(Object.keys(cache.asistencia).filter(d => (cache.asistencia[d]||[]).length > 0));
  const diasAbiertos      = [...new Set([...diasConLavados2, ...diasConAsist])].sort();
  const totalDiasAbiertos = Math.max(1, diasAbiertos.length);
  // Meses con actividad → para saber cuántos días/mes promedio se trabaja
  const mesesConActividad = [...new Set(diasAbiertos.map(d=>d.slice(0,7)))];
  const diasPorMes        = mesesConActividad.length > 0 ? Math.round(diasAbiertos.length / mesesConActividad.length) : 26;

  // Promedios — solo sobre días realmente abiertos (con personal fichado)
  const ingrSoloLav     = cache.caja.filter(c=>c.cat==='Lavado'&&c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const totalEgrOper    = cajaOp.filter(c=>c.tipo==='egreso'&&esOper(c)).reduce((s,c)=>s+c.monto,0);
  const promLavados     = (soloLavados.length / totalDiasAbiertos).toFixed(1);
  const promIngr        = Math.round(ingrSoloLav / totalDiasAbiertos);
  const promUtil        = Math.round((totalIngr - totalEgrOper) / totalDiasAbiertos);
  const conteoSrv       = {};
  soloLavados.forEach(l=>{ conteoSrv[l.servicio]=(conteoSrv[l.servicio]||0)+1; });
  const topSrv          = Object.entries(conteoSrv).sort((a,b)=>b[1]-a[1])[0];
  // Ticket promedio: solo lavados con precio real
  const ticketProm      = lavadosConPrecio.length > 0 ? Math.round(ingrSoloLav / lavadosConPrecio.length) : 0;

  // Análisis por día de semana — cuántos autos en promedio por cada día
  const NOM_DIA  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const lavXDow  = [0,0,0,0,0,0,0];   // total lavados acumulado por día de semana
  const aperXDow = [0,0,0,0,0,0,0];   // veces que ese día de semana estuvo abierto
  soloLavados.forEach(l => { lavXDow[new Date(l.fecha+'T12:00').getDay()]++; });
  diasAbiertos.forEach(d => { aperXDow[new Date(d+'T12:00').getDay()]++; });
  const promXDow = lavXDow.map((t,i) => aperXDow[i] > 0 ? +(t/aperXDow[i]).toFixed(1) : 0);
  const mejorDow = promXDow.indexOf(Math.max(...promXDow.filter((_,i)=>aperXDow[i]>0)));

  // Empleados: rango seleccionable — descontar lo ya pagado en ese rango
  const savedF1 = document.getElementById('dash-emp-f1')?.value;
  const savedF2 = document.getElementById('dash-emp-f2')?.value;
  const empF1 = savedF1 || si;
  const empF2 = savedF2 || semFin();
  const diasEmp = diasEnRango(empF1, empF2);
  let deudaSemana = 0;
  const resEmp = cache.empleados.map(e => {
    const diasTrab  = diasEmp.filter(d=>(cache.asistencia[d]||[]).includes(e.id)).length;
    const bruto     = diasTrab * e.jornal;
    // Solo adelantos del período visible (mismo criterio que cerrarSemana)
    const adlPend   = cache.adelantos.filter(a=>a.empId===e.id&&!a.pagado&&a.fecha>=empF1&&a.fecha<=empF2).reduce((s,a)=>s+a.monto,0);
    // Descontar el bruto ya cubierto en cierres de semana del rango.
    // Usamos ep.bruto (no ep.neto) porque los adelantos ya están marcados como pagados.
    // Deduplicamos por f1+f2 para no contar doble si hay registros duplicados.
    const semanasVistas = new Set();
    const yaPagado = (cache.semanasPagadas||[])
      .filter(sp=>sp.f1>=empF1&&sp.f2<=empF2)
      .sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''))
      .reduce((s,sp)=>{
        const key = sp.f1+'|'+sp.f2;
        if(semanasVistas.has(key)) return s;
        semanasVistas.add(key);
        const ep = (sp.empleados||[]).find(x=>x.empId===e.id);
        return s + (ep ? (ep.bruto ?? ep.neto) : 0);
      }, 0);
    const neto = bruto - adlPend - yaPagado;
    deudaSemana += Math.max(0, neto);
    return {nombre:e.nombre, diasTrab, bruto, adlPend, yaPagado, neto, color:e.color};
  });

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat" style="border-color:var(--cyan)"><div class="slbl">Lavados totales</div><div class="sval c">${soloLavados.length}</div><div style="font-size:10px;color:var(--muted2);margin-top:3px">desde el 16/03</div></div>
    <div class="stat"><div class="slbl">Lavados semana</div><div class="sval c">${lavS}</div></div>
    <div class="stat"><div class="slbl">Ingr. semana</div><div class="sval g">${fmt(ingrS)}</div></div>
    <div class="stat"><div class="slbl">Util. operativa sem.</div><div class="sval ${ingrS-egrSOper>=0?'g':'r'}">${fmt(ingrS-egrSOper)}</div></div>
    <div class="stat"><div class="slbl">Ingr. mes</div><div class="sval g">${fmt(ingrM)}</div></div>
    <div class="stat"><div class="slbl">Util. operativa mes</div><div class="sval ${ingrM-egrMOper>=0?'g':'r'}">${fmt(ingrM-egrMOper)}</div></div>
    <div class="stat"><div class="slbl">Prom. lavados/día</div><div class="sval c">${promLavados}</div><div style="font-size:10px;color:var(--muted2);margin-top:2px">${totalDiasAbiertos} días abiertos</div></div>
    <div class="stat"><div class="slbl">Prom. ingr. lavados/día</div><div class="sval g">${fmt(promIngr)}</div><div style="font-size:10px;color:var(--muted2);margin-top:2px">solo días con personal</div></div>
    <div class="stat"><div class="slbl">Prom. util. operativa/día</div><div class="sval ${promUtil>=0?'g':'r'}">${fmt(promUtil)}</div><div style="font-size:10px;color:var(--muted2);margin-top:2px">solo días con personal</div></div>
    <div class="stat"><div class="slbl">Ticket prom. lavado</div><div class="sval a">${fmt(ticketProm)}</div></div>
    ${topSrv?`<div class="stat"><div class="slbl">Lavado top</div><div class="sval c" style="font-size:13px;">${topSrv[0]}</div><div style="font-size:10px;color:var(--muted);margin-top:2px">${topSrv[1]} veces</div></div>`:''}
    <div class="stat" style="border-color:var(--amber)"><div class="slbl">A pagar empleados</div><div class="sval a">${fmt(deudaSemana)}</div><div style="font-size:10px;color:var(--muted2);margin-top:2px">rango seleccionado</div></div>
    <div class="stat" style="border-color:#a78bfa"><div class="slbl">💰 Extracciones dueños</div><div class="sval" style="color:#a78bfa">${fmt(totalExtracciones)}</div><div style="font-size:10px;color:var(--muted2);margin-top:2px">acumulado total</div></div>
    ${(()=>{
      const totalCF = (cache.costosFijos||[]).reduce((s,c)=>s+c.monto,0);
      const lavCP   = cache.lavados.filter(l=>l.cat!=='Bebida'&&l.precio>0);
      const iLav    = cache.caja.filter(c=>c.cat==='Lavado'&&c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
      const tProm   = lavCP.length > 0 ? Math.round(iLav/lavCP.length) : 0;
      const sueld   = cache.empleados.reduce((s,e)=>s+e.jornal,0) * diasPorMes;
      const beTotal = tProm > 0 ? Math.ceil((totalCF+sueld)/tProm) : 0;
      const beDia   = tProm > 0 ? Math.ceil((totalCF+sueld)/Math.max(1,diasPorMes)/tProm) : 0;
      return totalCF > 0 && tProm > 0
        ? `<div class="stat" style="border-color:var(--cyan)"><div class="slbl">🚗 Punto de equilibrio</div><div class="sval c">${beTotal}/mes</div><div style="font-size:10px;color:var(--muted2);margin-top:2px">${beDia} autos/día · ~${diasPorMes}d/mes</div></div>`
        : '';
    })()}
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

  // Gráfico utilidad operativa últimos 7 días — mismo criterio que "Resumen por día"
  // Ingresos = lavados + bebidas; Egresos = jornal devengado (asistencia)
  const util7 = dias7.map(d => {
    const cDia    = cajaOp.filter(c=>c.fecha===d);
    const ingrLav = cDia.filter(c=>c.cat==='Lavado').reduce((s,c)=>s+c.monto,0);
    const ingrBeb = cDia.filter(c=>c.cat==='Bebidas').reduce((s,c)=>s+c.monto,0);
    const jDia    = cache.empleados.reduce((s,e)=>s+((cache.asistencia[d]||[]).includes(e.id)?e.jornal:0),0);
    return ingrLav + ingrBeb - jDia;
  });
  const maxUtil7 = Math.max(...util7.map(Math.abs), 1);
  const utilChartEl = document.getElementById('dash-util-chart');
  if(utilChartEl) {
    utilChartEl.innerHTML = dias7.map((d,i) => {
      const v = util7[i];
      const hh = Math.max(3, Math.round((Math.abs(v)/maxUtil7)*90));
      const col = v >= 0 ? 'var(--green)' : 'var(--red)';
      const lbl = v !== 0 ? (v>0?'+':'-')+'$'+(Math.abs(v)/1000).toFixed(0)+'k' : '';
      return `<div class="bc-col" onclick="verDetalleDia('${d}')" style="cursor:pointer;" title="${fmtDL(d)}: ${fmt(v)}">
        <div class="bc-val" style="color:${col}">${lbl}</div>
        <div class="bc-bar ${i===6?'hoy':''}" style="height:${hh}px;background:${col};opacity:${i===6?1:.75};"></div>
        <div class="bc-lbl">${DIAS_S[new Date(d+'T12:00').getDay()]}</div>
      </div>`;
    }).join('');
  }

  // Gráfico días de la semana
  const dowEl = document.getElementById('dash-dow-chart');
  const badgeEl = document.getElementById('mejor-dia-badge');
  if(dowEl) {
    const maxDow = Math.max(...promXDow, 1);
    dowEl.innerHTML = NOM_DIA.map((nom,i) => {
      const val  = promXDow[i];
      const apert = aperXDow[i];
      if(apert === 0) return `<div class="bc-col" style="flex:1;opacity:.3">
        <div class="bc-val" style="font-size:9px;color:var(--muted2)"></div>
        <div class="bc-bar" style="height:3px;background:var(--border);border-radius:4px 4px 0 0;width:100%;"></div>
        <div class="bc-lbl" style="font-size:10px;color:var(--muted2)">${nom}</div>
      </div>`;
      const pct  = Math.max(4, Math.round((val/maxDow)*90));
      const esBest = i === mejorDow;
      return `<div class="bc-col" style="flex:1;" title="${nom}: ${val} autos/día (${apert} aperturas)">
        <div class="bc-val" style="font-size:9px;color:${esBest?'var(--cyan)':'var(--muted)'};">${val}</div>
        <div class="bc-bar ${esBest?'hoy':''}" style="height:${pct}px;background:${esBest?'var(--cyan)':'var(--border2)'};border-radius:4px 4px 0 0;width:100%;opacity:${esBest?'1':'.7'};"></div>
        <div class="bc-lbl" style="font-size:10px;color:${esBest?'var(--cyan)':'var(--muted2)'};font-weight:${esBest?'700':'400'}">${nom}</div>
      </div>`;
    }).join('');
    if(badgeEl) badgeEl.textContent = aperXDow.some(v=>v>0) ? `⭐ Mejor: ${NOM_DIA[mejorDow]} (${promXDow[mejorDow]} autos/día)` : '';
  }

  // Promedio mensual de lavados — con exclusión de días de semana ("qué pasaría si")
  const promMesEl = document.getElementById('dash-prom-mes');
  if(promMesEl) {
    const incl = i => !_dowExcl.has(i);
    // Autos en días incluidos (reutiliza lavXDow ya indexado por día de semana)
    const carsIncl = lavXDow.reduce((s,t,i)=> s + (incl(i) ? t : 0), 0);
    // Días abiertos incluidos y meses distintos entre ellos
    const diasInclList = diasAbiertos.filter(d => incl(new Date(d+'T12:00').getDay()));
    const mesesIncl    = new Set(diasInclList.map(d=>d.slice(0,7))).size;
    const promMes = mesesIncl ? Math.round(carsIncl / mesesIncl) : 0;
    const promDia = diasInclList.length ? (carsIncl / diasInclList.length).toFixed(1) : '0';
    const hayExcl = _dowExcl.size > 0;

    const chips = NOM_DIA.map((nom,i)=>{
      const on = incl(i);
      return `<button class="qd ${on?'on':''}" onclick="toggleDowExcl(${i})"
        style="${on?'':'text-decoration:line-through;opacity:.55;'}">${nom}</button>`;
    }).join('');

    promMesEl.innerHTML = `
      <div class="qdate" style="margin-bottom:14px;">${chips}</div>
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
        <div class="sval c" style="font-size:34px;">≈ ${promMes}</div>
        <div style="font-size:13px;color:var(--muted);font-weight:600;">autos / mes</div>
        ${hayExcl?`<span class="badge ba" style="align-self:center;">excluyendo ${[..._dowExcl].map(i=>NOM_DIA[i]).join(', ')}</span>`:''}
      </div>
      <div style="font-size:11px;color:var(--muted2);margin-top:6px;font-variant-numeric:tabular-nums;">
        ${promDia} autos/día · ${mesesIncl} ${mesesIncl===1?'mes':'meses'} · ${diasInclList.length} días considerados
      </div>`;
  }

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
  // Otros ingresos: alquileres (cocheras, galpón, local) y demás — viven en caja, no en lavados
  const otrosIngr = cajaOp.filter(c=>c.tipo==='ingreso'&&c.cat!=='Lavado'&&c.cat!=='Bebidas');
  const ingrOtros = otrosIngr.reduce((s,c)=>s+c.monto,0);
  const egresos  = cajaOp.filter(c=>c.tipo==='egreso');
  const egrCaja  = egresos.reduce((s,c)=>s+c.monto,0);
  // Jornal devengado ese día (virtual — no está en caja a menos que se haya cerrado semana)
  const jDia = cache.empleados.reduce((s,e)=>
    s + ((cache.asistencia[fecha]||[]).includes(e.id) ? e.jornal : 0), 0);
  const totalIngr = ingrLav + ingrBeb + ingrOtros;
  const totalEgr  = egrCaja + jDia;

  document.getElementById('dash-dia-titulo').textContent = `Detalle del ${fmtDL(fecha)}`;
  document.getElementById('dash-dia-card').style.display = '';
  document.getElementById('dash-dia-card').scrollIntoView({behavior:'smooth', block:'start'});

  // Tabla ingresos: lavados/bebidas (de cache.lavados) + otros ingresos de caja (alquileres, etc.)
  const filasIngr = lavsDia.map(l=>`<tr>
    <td>${l.hora||'—'}</td>
    <td><span class="badge bc">${l.servicio}</span></td>
    <td style="color:var(--muted)">${l.cat}</td>
    <td>${l.patente?`<span class="badge ba">${l.patente}</span>`:'—'}</td>
    <td>${l.pago}</td>
    <td style="color:var(--green);font-weight:700">${fmt(l.precio)}</td>
  </tr>`);
  otrosIngr.forEach(c=>filasIngr.push(`<tr>
    <td>—</td>
    <td><span class="badge bg_">${c.cat}</span></td>
    <td style="color:var(--muted)">${c.desc||'—'}</td>
    <td>—</td>
    <td>${c.pago||'—'}</td>
    <td style="color:var(--green);font-weight:700">${fmt(c.monto)}</td>
  </tr>`));
  document.getElementById('dash-dia-tbody').innerHTML = filasIngr.length
    ? filasIngr.join('')
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
    ${ingrOtros>0?`<div style="font-size:12px;color:var(--muted)">Otros ingr.: <strong style="color:var(--green)">${fmt(ingrOtros)}</strong></div>`:''}
    <div style="font-size:12px;color:var(--muted)">Total ingresos: <strong style="color:var(--green)">${fmt(totalIngr)}</strong></div>
    <div style="font-size:12px;color:var(--muted)">Total egresos: <strong style="color:var(--red)">${fmt(totalEgr)}</strong></div>
    <div style="font-size:13px;font-weight:700;color:${resultado>=0?'var(--green)':'var(--red)'}">Resultado: ${fmt(resultado)}</div>
  `;
};

window.cerrarDetalleDia = function() {
  document.getElementById('dash-dia-card').style.display = 'none';
};

// Toggle de exclusión de un día de semana en el promedio mensual
window.toggleDowExcl = function(i) {
  if(_dowExcl.has(i)) _dowExcl.delete(i); else _dowExcl.add(i);
  localStorage.setItem('titan_dow_excl', JSON.stringify([..._dowExcl]));
  renderDashboard();
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

  document.getElementById('qgrid-beb').innerHTML = cache.bebidas.filter(b=>b.nombre&&b.precio!=null).map(b => `
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
  if(!checkRateLimit('confirmar_'+cu?.id, 30)) return;
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

  document.getElementById('hist-f1').value = fechaReg;
  document.getElementById('hist-f2').value = fechaReg;
  renderQGrid(); renderHistorial(); renderDashboard();
  document.getElementById('reg-patente').value = '';
  if(btnC) btnC.classList.remove('loading');
  toast(`${selSrv.nombre}${cantTxt}${extra} — ${fmt(selSrv.precio * cantidad)}`, 'ok');
};

function _filtrarHistorial() {
  const f1   = document.getElementById('hist-f1')?.value || hoy();
  const f2   = document.getElementById('hist-f2')?.value || hoy();
  const tipo = document.getElementById('hist-tipo')?.value || '';
  let lavs = cache.lavados.filter(l=>l.fecha>=f1&&l.fecha<=f2);
  if(tipo==='lavado') lavs = lavs.filter(l=>l.cat!=='Bebida');
  if(tipo==='bebida') lavs = lavs.filter(l=>l.cat==='Bebida');
  return lavs.sort((a,b)=>b.fecha.localeCompare(a.fecha)||((b.hora||'').localeCompare(a.hora||'')));
}

function renderHistorial() {
  const lavs    = _filtrarHistorial();
  const total   = lavs.reduce((s,l)=>s+l.precio,0);
  const efect   = lavs.filter(l=>l.pago==='Efectivo').reduce((s,l)=>s+l.precio,0);
  const transf  = lavs.filter(l=>l.pago==='Transferencia').reduce((s,l)=>s+l.precio,0);
  const debito  = lavs.filter(l=>l.pago==='Débito').reduce((s,l)=>s+l.precio,0);
  const credito = lavs.filter(l=>l.pago==='Crédito').reduce((s,l)=>s+l.precio,0);

  const resumenPagos = [
    efect   > 0 ? `💵 Efectivo: <strong style="color:var(--green)">${fmt(efect)}</strong>`     : '',
    transf  > 0 ? `💳 Transf.: <strong style="color:var(--cyan)">${fmt(transf)}</strong>`      : '',
    debito  > 0 ? `💳 Débito: <strong style="color:var(--cyan)">${fmt(debito)}</strong>`        : '',
    credito > 0 ? `💳 Crédito: <strong style="color:var(--amber)">${fmt(credito)}</strong>`    : '',
  ].filter(Boolean).join('<span style="color:var(--border2);margin:0 6px">|</span>');

  // Resumen agrupado por servicio+precio
  const grupos = {};
  lavs.forEach(l => {
    const k = `${l.servicio}||${l.precio}`;
    if(!grupos[k]) grupos[k] = {servicio: l.servicio, precio: l.precio, cat: l.cat, count: 0};
    grupos[k].count++;
  });
  const resumenSrv = Object.values(grupos)
    .sort((a,b)=>b.count-a.count)
    .map(g=>`<span style="display:inline-flex;align-items:center;gap:5px;background:var(--dark3);border:1px solid var(--border);border-radius:8px;padding:4px 10px;font-size:12px;">
      <span class="badge ${g.cat==='Bebida'?'ba':'bc'}" style="font-size:10px;">${sanitize(g.servicio)}</span>
      <strong style="color:var(--white)">${g.count}</strong>
      <span style="color:var(--muted)">×</span>
      <span style="color:var(--green);font-weight:600">${fmt(g.precio)}</span>
    </span>`).join('');

  document.getElementById('tbody-reg').innerHTML = lavs.length
    ? lavs.map(l=>`<tr>
        <td style="color:var(--muted);white-space:nowrap">${fmtD(l.fecha)}</td>
        <td>${l.hora||'—'}</td>
        <td><span class="badge ${l.cat==='Bebida'?'ba':'bc'}">${sanitize(l.servicio)}</span></td>
        <td>${l.patente?`<span class="badge ba">${sanitize(l.patente)}</span>`:'—'}</td>
        <td>${sanitize(l.pago)}</td>
        <td style="color:var(--green);font-weight:700">${fmt(l.precio)}</td>
        <td style="color:var(--muted2)">${sanitize(l.user||'—')}</td>
        <td><button class="btn br" onclick="eliminarLavado('${l.id}','${l.fecha}',${l.precio},'${sanitize(l.servicio)}','${sanitize(l.patente||'')}')">✕</button></td>
      </tr>`).join('') +
      `<tr class="total-row">
        <td colspan="4" style="color:var(--muted);font-size:11px;">${resumenPagos}</td>
        <td style="color:var(--muted)">Total (${lavs.length})</td>
        <td style="color:var(--green)">${fmt(total)}</td>
        <td colspan="2"></td>
      </tr>`
    : '<tr><td colspan="8" class="empty">Sin registros para este período</td></tr>';

  // Resumen por servicio debajo de la tabla
  const srvEl = document.getElementById('hist-resumen-srv');
  if(srvEl) srvEl.innerHTML = lavs.length && Object.keys(grupos).length > 1
    ? `<div style="font-size:11px;color:var(--muted);font-weight:600;margin-bottom:6px;letter-spacing:.3px;">RESUMEN POR SERVICIO</div>
       <div style="display:flex;flex-wrap:wrap;gap:6px;">${resumenSrv}</div>`
    : '';
}

window.setRangoHistorial = function(rango) {
  const h = hoy();
  if(rango==='hoy')    { document.getElementById('hist-f1').value=h; document.getElementById('hist-f2').value=h; }
  if(rango==='semana') { document.getElementById('hist-f1').value=semIni(); document.getElementById('hist-f2').value=h; }
  if(rango==='mes')    { document.getElementById('hist-f1').value=h.slice(0,7)+'-01'; document.getElementById('hist-f2').value=h; }
  document.querySelectorAll('#s-registrar .qdate .qd').forEach(b=>b.classList.remove('on'));
  event.target.classList.add('on');
  renderHistorial();
};

window.exportarHistorial = function() {
  const f1  = document.getElementById('hist-f1')?.value || hoy();
  const f2  = document.getElementById('hist-f2')?.value || hoy();
  const lavs = _filtrarHistorial();
  exportCSV(
    ['Fecha','Hora','Servicio','Categoría','Patente','Pago','Precio','Operador'],
    lavs.map(l=>[l.fecha,l.hora||'',l.servicio,l.cat||'',l.patente||'',l.pago,l.precio,l.user||'']),
    `historial-${f1}-${f2}.csv`
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
window.onCxTipoChange = function() {
  const esEgreso = document.getElementById('cx-tipo').value === 'egreso';
  const wrap = document.getElementById('cx-cf-wrap');
  if(!wrap) return;
  wrap.style.display = esEgreso ? '' : 'none';
  if(esEgreso) {
    const sel = document.getElementById('cx-cf');
    sel.innerHTML = '<option value="">— Ninguno —</option>' +
      (cache.costosFijos||[]).map(c=>`<option value="${c.id}">${c.nombre} (${c.categoria})</option>`).join('');
  }
};

window.agregarMovExtraord = async function() {
  if(!checkRateLimit('mov_'+cu?.id, 10)) return;
  const monto = Number(document.getElementById('cx-monto').value);
  if(!monto||monto<=0) { toast('Ingresá un monto válido','err'); return; }
  const tipo  = document.getElementById('cx-tipo').value;
  const cfId  = tipo === 'egreso' ? (document.getElementById('cx-cf')?.value || '') : '';
  const mov = {
    fecha: document.getElementById('cx-fecha').value || hoy(),
    tipo,
    cat:  document.getElementById('cx-cat').value,
    desc: document.getElementById('cx-desc').value.trim(),
    monto, pago:'—', user: cu.nombre,
    ...(cfId ? {costoFijoId: cfId} : {})
  };
  const id = await fsAdd('caja', mov);
  cache.caja.push({id, ...mov});
  await auditLog('CAJA MANUAL', `${mov.tipo.toUpperCase()} — ${mov.cat} — ${fmt(monto)}`);
  renderCaja(); renderDashboard(); renderCostosFijos(); toast('Guardado','ok');
  document.getElementById('cx-monto').value = '';
  document.getElementById('cx-desc').value  = '';
  document.getElementById('cx-cf').value    = '';
};

let _cxTipo = ''; // '' | 'ingreso' | 'egreso'

window.setTipoCaja = function(tipo) {
  _cxTipo = _cxTipo === tipo ? '' : tipo; // toggle
  document.getElementById('cx-btn-ingr').classList.toggle('on', _cxTipo==='ingreso');
  document.getElementById('cx-btn-egr' ).classList.toggle('on', _cxTipo==='egreso');
  // Si se elige tipo rápido, limpiar combo de categoría
  if(_cxTipo) document.getElementById('cx-fcat').value = '';
  renderCaja();
};

window.onCajaCatChange = function() {
  // Si se elige una categoría específica, limpiar filtro de tipo rápido
  if(document.getElementById('cx-fcat').value) {
    _cxTipo = '';
    document.getElementById('cx-btn-ingr').classList.remove('on');
    document.getElementById('cx-btn-egr' ).classList.remove('on');
  }
  renderCaja();
};

function renderCaja() {
  const f1  = document.getElementById('cx-f1').value;
  const f2  = document.getElementById('cx-f2').value;
  const cat = document.getElementById('cx-fcat').value;
  let movs  = [...cache.caja];
  if(f1)     movs = movs.filter(m=>m.fecha>=f1);
  if(f2)     movs = movs.filter(m=>m.fecha<=f2);
  if(cat)    movs = movs.filter(m=>m.cat===cat);
  if(_cxTipo) movs = movs.filter(m=>m.tipo===_cxTipo);
  movs.sort((a,b)=>b.fecha?.localeCompare(a.fecha||'')||0);

  const ingr      = movs.filter(m=>m.tipo==='ingreso'&&m.cat!=='Saldo inicial').reduce((s,m)=>s+m.monto,0);
  const egr       = movs.filter(m=>m.tipo==='egreso'&&m.cat!=='Extracción dueños').reduce((s,m)=>s+m.monto,0);
  const extracc   = movs.filter(m=>m.cat==='Extracción dueños').reduce((s,m)=>s+m.monto,0);
  const efect     = movs.filter(m=>m.tipo==='ingreso'&&m.pago==='Efectivo'&&m.cat!=='Saldo inicial').reduce((s,m)=>s+m.monto,0);
  // Saldo total global siempre (independiente del filtro)
  const saldoBase = cache.caja.filter(c=>c.cat==='Saldo inicial').reduce((s,c)=>s+c.monto,0);
  const cajaOp2   = cache.caja.filter(c=>c.cat!=='Saldo inicial');
  const totalIngr = cajaOp2.filter(c=>c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
  const totalEgr  = cajaOp2.filter(c=>c.tipo==='egreso').reduce((s,c)=>s+c.monto,0);
  const saldoTotal= saldoBase + totalIngr - totalEgr;

  document.getElementById('caja-stats').innerHTML = `
    <div class="stat"><div class="slbl">Ingresos (filtro)</div><div class="sval g">${fmt(ingr)}</div></div>
    <div class="stat"><div class="slbl">Egresos operativos</div><div class="sval r">${fmt(egr)}</div></div>
    <div class="stat"><div class="slbl">Resultado filtro</div><div class="sval ${ingr-egr>=0?'g':'r'}">${fmt(ingr-egr)}</div></div>
    <div class="stat"><div class="slbl">Efectivo ingr.</div><div class="sval a">${fmt(efect)}</div></div>
    <div class="stat" style="border-color:#a78bfa"><div class="slbl">💰 Extracciones dueños</div><div class="sval" style="color:#a78bfa">${fmt(extracc)}</div></div>
    <div class="stat" style="border-color:var(--cyan)"><div class="slbl">Saldo total en caja</div><div class="sval ${saldoTotal>=0?'g':'r'}">${fmt(saldoTotal)}</div></div>
  `;
  document.getElementById('tbody-caja').innerHTML = movs.length
    ? movs.map(m=>`<tr>
        <td>${fmtDL(m.fecha)}</td>
        <td><span class="badge ${m.tipo==='ingreso'?'bg_':'br_'}">${m.tipo}</span></td>
        <td>${m.cat}</td>
        <td style="color:var(--muted)">${sanitize(m.desc||'—')}</td>
        <td style="font-weight:700;color:${m.tipo==='ingreso'?'var(--green)':'var(--red)'}">${fmt(m.monto)}</td>
        <td style="color:var(--muted2)">${sanitize(m.user||'—')}</td>
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

  // Saldo acumulado real ANTES de la fecha dada (TODOS los movimientos)
  const allMov = cajaOp.slice().sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||''));
  function saldoAntesDe(fecha) {
    return saldoBase + allMov
      .filter(c=>c.fecha<fecha)
      .reduce((s,c)=>s+(c.tipo==='ingreso'?c.monto:-c.monto),0);
  }

  let tIngresos=0, tEgresos=0;
  const filas = diasActivos.map(fecha=>{
    const cajaDia = cajaOp.filter(c=>c.fecha===fecha);
    // Ingresos: ABSOLUTAMENTE todos (lavados, bebidas, alquileres/cocheras, otros)
    const ingrDia  = cajaDia.filter(c=>c.tipo==='ingreso').reduce((s,c)=>s+c.monto,0);
    // Egresos: TODOS los movimientos reales de caja (incluye sueldos pagados)
    const egrDia   = cajaDia.filter(c=>c.tipo==='egreso').reduce((s,c)=>s+c.monto,0);
    const saldoIni = saldoAntesDe(fecha);
    const saldoFin = saldoIni + ingrDia - egrDia;
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
  // Saldo final real al cierre del último día (con TODOS los egresos incluidos)
  const ultimoDia = diasActivos[diasActivos.length-1];
  const saldoFinTotal = saldoBase + allMov
    .filter(c=>c.fecha<=ultimoDia)
    .reduce((s,c)=>s+(c.tipo==='ingreso'?c.monto:-c.monto),0);

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

  // Verificar si esta semana ya fue pagada (mismo criterio que dashboard)
  const semanaPagada = (cache.semanasPagadas||[]).some(sp=>sp.f1===f1&&sp.f2===f2);

  document.getElementById('emp-grid').innerHTML = cache.empleados.map(e => {
    // Solo adelantos pendientes dentro del período seleccionado (igual que cerrarSemana)
    const adlSem   = cache.adelantos.filter(a=>a.empId===e.id&&!a.pagado&&a.fecha>=f1&&a.fecha<=f2);
    const totalAdl = adlSem.reduce((s,a)=>s+a.monto,0);
    const diasTrab = dias.filter(d=>(cache.asistencia[d]||[]).includes(e.id));
    const bruto    = diasTrab.length * e.jornal;

    // Descontar lo ya pagado en semanasPagadas (mismo cálculo que dashboard)
    const semanasVistas = new Set();
    const yaPagado = (cache.semanasPagadas||[])
      .filter(sp=>sp.f1>=f1&&sp.f2<=f2)
      .sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''))
      .reduce((s,sp)=>{
        const key = sp.f1+'|'+sp.f2;
        if(semanasVistas.has(key)) return s;
        semanasVistas.add(key);
        const ep = (sp.empleados||[]).find(x=>x.empId===e.id);
        return s + (ep ? (ep.bruto ?? ep.neto) : 0);
      }, 0);

    const neto = bruto - totalAdl - yaPagado;

    const diaButtons = dias.map(d => {
      const worked  = (cache.asistencia[d]||[]).includes(e.id);
      const isToday = d === hoyS;
      const label   = DIAS_S[new Date(d+'T12:00').getDay()];
      const dayNum  = new Date(d+'T12:00').getDate();
      return `<button class="dia-btn${worked?' worked':''}${isToday?' today':''}"
        title="${fmtDL(d)}"
        onclick="toggleDia('${e.id}','${d}')">${dayNum}<br><span style="font-size:8px">${label}</span></button>`;
    }).join('');

    return `<div class="ecard" style="${yaPagado>0?'border-color:rgba(46,204,138,.3)':''}">
      <div class="ecard-hdr" style="${yaPagado>0?'background:rgba(46,204,138,.06)':''}">
        <div class="eav" style="background:${e.color}22;color:${e.color}">${e.nombre.charAt(0)}</div>
        <div>
          <div style="font-size:14px;font-weight:600;">${e.nombre}</div>
          <div style="font-size:11px;color:var(--muted)">${fmt(e.jornal)}/día</div>
        </div>
        ${yaPagado>0?'<span style="font-size:10px;font-weight:700;color:var(--green);margin-left:auto;">✓ PAGADO</span>':''}
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
      <div class="ecard-foot" style="${neto===0||yaPagado>0?'background:rgba(46,204,138,.08);':''}">
        <span style="font-size:11px;color:var(--muted)">${yaPagado>0?'Semana pagada':'A cobrar'}</span>
        <span style="font-size:18px;font-weight:700;color:${neto>0?'var(--amber)':neto===0?'var(--green)':'var(--red)'}">
          ${neto>0?fmt(neto):neto===0?'✓ $0':'− '+fmt(Math.abs(neto))}
        </span>
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
  const f1  = document.getElementById('sem-ini').value || semIni();
  const f2  = document.getElementById('sem-fin').value || semFin();
  const dias = diasEnRango(f1, f2);

  // Guardia: no permitir pagar una semana ya cerrada
  const yaExiste = (cache.semanasPagadas||[]).some(sp=>sp.f1===f1&&sp.f2===f2);
  if(yaExiste) {
    toast(`La semana ${fmtDL(f1)}–${fmtDL(f2)} ya fue pagada`, 'warn');
    return;
  }

  // ── Pre-calcular para mostrar resumen antes de confirmar ──────
  const datosEmp = cache.empleados.map(e => {
    const diasTrab   = dias.filter(d=>(cache.asistencia[d]||[]).includes(e.id)).length;
    const bruto      = diasTrab * e.jornal;
    // Solo adelantos pendientes dentro del rango de la semana
    const adlsPend   = cache.adelantos.filter(a=>a.empId===e.id&&!a.pagado&&a.fecha>=f1&&a.fecha<=f2);
    const adelantado = adlsPend.reduce((s,a)=>s+a.monto,0);
    const neto       = bruto - adelantado;
    return {e, diasTrab, bruto, adlsPend, adelantado, neto};
  }).filter(x=>x.diasTrab>0||x.adelantado>0); // solo empleados con actividad

  if(!datosEmp.length) { toast('Sin actividad en este período','warn'); return; }

  const totalCaja = datosEmp.reduce((s,x)=>s+Math.max(0,x.neto),0);

  // Resumen legible para el confirm
  const lineas = datosEmp.map(x=>{
    const adlTxt = x.adelantado>0 ? ` − ${fmt(x.adelantado)} adelantos` : '';
    const nTxt   = x.neto>=0 ? `= ${fmt(x.neto)} a pagar` : `= ${fmt(Math.abs(x.neto))} a favor del negocio`;
    return `• ${x.e.nombre}: ${x.diasTrab}d × ${fmt(x.e.jornal)}${adlTxt} ${nTxt}`;
  });
  lineas.push(`\nTOTAL a descontar de caja: ${fmt(totalCaja)}`);
  if(!confirm(`PAGO DE SEMANA  ${fmtDL(f1)} al ${fmtDL(f2)}\n\n${lineas.join('\n')}\n\n¿Confirmar?`)) return;

  // ── Ejecutar pagos ────────────────────────────────────────────
  const pagosEmpleados = [];
  for(const {e, diasTrab, bruto, adlsPend, adelantado, neto} of datosEmp) {
    // Marcar todos sus adelantos pendientes como pagados
    for(const a of adlsPend) {
      await fsUpdate('adelantos', a.id, {pagado:true});
      const ca = cache.adelantos.find(x=>x.id===a.id);
      if(ca) ca.pagado = true;
    }
    // Solo registrar egreso en caja si hay diferencia positiva a pagar
    if(neto > 0) {
      const cm = {fecha:hoy(), tipo:'egreso', cat:'Sueldos',
        desc:`Sueldo ${e.nombre} — ${diasTrab} días (${fmtDL(f1)} al ${fmtDL(f2)})`,
        monto:neto, pago:'Efectivo', user:cu.nombre};
      const cmId = await fsAdd('caja', cm);
      cache.caja.push({id:cmId, ...cm});
    }
    pagosEmpleados.push({empId:e.id, nombre:e.nombre, diasTrab, bruto, adelantado, neto});
  }

  // Guardar semana pagada
  const semPagada = {f1, f2, total:totalCaja, fecha:hoy(), user:cu.nombre, empleados:pagosEmpleados};
  const spId = await fsAdd('semanasPagadas', semPagada);
  if(!cache.semanasPagadas) cache.semanasPagadas = [];
  cache.semanasPagadas.push({id:spId, ...semPagada});

  await auditLog('CIERRE SEMANA', `${fmtDL(f1)} al ${fmtDL(f2)} — ${fmt(totalCaja)}`);

  // ── Mostrar estado "todo pagado" antes de avanzar ─────────────
  renderEmpleados(); renderCaja(); renderDashboard();

  const resumenPago = datosEmp.map(x=>
    `${x.e.nombre}: ${x.neto > 0 ? fmt(x.neto) : '✓ $0'}`
  ).join(' · ');
  toast(`✓ Semana ${fmtDL(f1)}–${fmtDL(f2)} — Todo pagado al día  |  ${resumenPago}`, 'ok');

  // ── Avanzar a la próxima semana luego de 2.5 s ────────────────
  const fmtFecha = d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  setTimeout(() => {
    const sig    = new Date(f2+'T12:00'); sig.setDate(sig.getDate()+1);
    const sigFin = new Date(sig); sigFin.setDate(sig.getDate()+6);
    document.getElementById('sem-ini').value = fmtFecha(sig);
    document.getElementById('sem-fin').value = fmtFecha(sigFin);
    renderEmpleados();
    toast(`Semana ${fmtDL(fmtFecha(sig))}–${fmtDL(fmtFecha(sigFin))} lista para cargar`, 'ok');
  }, 2500);
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
  if(!requireAdmin()) return;
  const nombre = document.getElementById('nu-nombre').value.trim();
  const email  = document.getElementById('nu-email').value.trim().toLowerCase();
  if(!nombre||!email) { toast('Completá nombre y email','err'); return; }
  if(!email.includes('@')) { toast('Email inválido','err'); return; }
  if(cache.usuarios.find(u=>u.email&&u.email.toLowerCase()===email)) { toast('Ese email ya existe','err'); return; }
  const rol  = document.getElementById('nu-rol').value;
  const data = {nombre, email, rol};
  const id   = await fsAdd('usuarios', data);
  cache.usuarios.push({id, ...data});
  // Agregar al allowlist de Firestore para que las reglas lo permitan
  try {
    await db.collection('config').doc('allowlist').update({ [`emails.${email}`]: rol });
  } catch(e) {
    // Si el doc no existe aún lo creamos completo
    const emails = {};
    cache.usuarios.forEach(u => { if(u.email) emails[u.email.toLowerCase().trim()] = u.rol||'user'; });
    await db.collection('config').doc('allowlist').set({ emails });
  }
  auditLog('NUEVO USUARIO', `${nombre} (${email})`);
  renderUsers(); closeM('m-user'); toast('Usuario agregado','ok');
  ['nu-nombre','nu-email'].forEach(i=>document.getElementById(i).value='');
};

window.eliminarUser = async function(id) {
  if(!requireAdmin()) return;
  if(id===cu.id) { toast('No podés eliminarte','err'); return; }
  if(!confirm('¿Eliminar usuario?')) return;
  const u = cache.usuarios.find(x=>x.id===id);
  await fsDel('usuarios', id);
  cache.usuarios = cache.usuarios.filter(x=>x.id!==id);
  // Quitar del allowlist de Firestore
  if(u?.email) {
    try {
      await db.collection('config').doc('allowlist').update({
        [`emails.${u.email.toLowerCase().trim()}`]: firebase.firestore.FieldValue.delete()
      });
    } catch(e) { console.warn('No se pudo actualizar allowlist:', e); }
  }
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
  if(!requireAdmin()) return;
  const nombre = document.getElementById('ns-nombre').value.trim();
  const precio = Number(document.getElementById('ns-precio').value);
  if(precio <= 0 || precio > 100000000) { toast('Precio inválido','err'); return; }
  if(!nombre||!precio) { toast('Completá nombre y precio','err'); return; }
  const data = {nombre, precio, cat:document.getElementById('ns-cat').value, tipo:document.getElementById('ns-tipo').value};
  const id = await fsAdd('servicios', data);
  cache.servicios.push({id, ...data});
  await auditLog('NUEVO SERVICIO', `${nombre} — ${fmt(precio)}`);
  renderSrvcfg(); renderQGrid(); closeM('m-srv'); toast('Servicio guardado','ok');
  ['ns-nombre','ns-precio'].forEach(i=>document.getElementById(i).value='');
};

window.eliminarSrv = async function(id) {
  if(!requireAdmin()) return;
  if(!confirm('¿Eliminar?')) return;
  await fsDel('servicios', id);
  cache.servicios = cache.servicios.filter(s=>s.id!==id);
  renderSrvcfg(); renderQGrid(); toast('Eliminado','ok');
};

function fillStockSelects() {
  const opts = cache.bebidas.filter(b=>b.nombre&&b.precio!=null).map(b=>`<option value="${b.id}">${b.nombre} (stock: ${b.stock||0})</option>`).join('');
  ['stock-beb','stock-beb2'].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=opts; });
}

function fillStockSelect() { fillStockSelects(); }

function renderBebcfg() {
  document.getElementById('cfg-beb').innerHTML = cache.bebidas.map(b=>{
    // Bebida con datos dañados (sin nombre o sin precio) — ofrecer recuperación
    if(!b.nombre || b.precio === undefined || b.precio === null) {
      return `<div class="srv-cfg-card" style="border-color:var(--red)">
        <div style="font-size:11px;color:var(--red);font-weight:700;margin-bottom:6px">⚠️ Datos incompletos</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">Stock: <strong>${b.stock||0}</strong></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn bp" style="font-size:11px;padding:5px 10px" onclick="recuperarBeb('${b.id}')">Recuperar</button>
          <button class="btn br" onclick="eliminarBeb('${b.id}')">Eliminar</button>
        </div>
      </div>`;
    }
    const stockBajo = b.alertaMin && (b.stock||0) < b.alertaMin;
    return `<div class="srv-cfg-card" style="${stockBajo?'border-color:var(--amber)':''}">
      <div style="margin-bottom:8px">${bebidaIcon(b.nombre, 40)}</div>
      <div style="font-size:12px;font-weight:600;margin-bottom:3px">${sanitize(b.nombre)}</div>
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

window.recuperarBeb = async function(id) {
  if(!requireAdmin()) return;
  const beb = cache.bebidas.find(b=>b.id===id);
  if(!beb) return;
  const nombre = prompt('Nombre de la bebida:', beb.nombre||'');
  if(!nombre) return;
  const precioStr = prompt('Precio ($):', beb.precio||'');
  const precio = Number(precioStr);
  if(!precio || precio<=0) { toast('Precio inválido','err'); return; }
  const alertaMin = beb.alertaMin || 6;
  await fsUpdate('bebidas', id, {nombre:nombre.trim(), precio, alertaMin, stock: beb.stock||0});
  beb.nombre = nombre.trim(); beb.precio = precio; beb.alertaMin = alertaMin;
  auditLog('RECUPERAR BEBIDA', `${nombre} — ${fmt(precio)}`);
  renderBebcfg(); renderQGrid(); renderStock();
  toast(`Bebida recuperada: ${nombre}`,'ok');
};

window.crearBebida = async function() {
  if(!requireAdmin()) return;
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
  if(!requireAdmin()) return;
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

  // Cards de bebidas (excluir las dañadas — se recuperan desde Config)
  document.getElementById('stock-cards-grid').innerHTML = cache.bebidas.filter(b=>b.nombre&&b.precio!=null).map(b => {
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
        const esVenta   = h.motivo === 'venta';
        const motLabel  = esVenta ? '<span style="color:var(--cyan);font-size:10px;">venta</span>'
                        : h.motivo ? `<span style="color:var(--muted2);font-size:10px;">${h.motivo}</span>`
                        : '—';
        return `<tr>
          <td style="color:var(--muted2)">${ds}</td>
          <td style="font-weight:500">${h.bebida}</td>
          <td style="color:${esIngreso?'var(--green)':'var(--red)'};font-weight:600">${esIngreso?'+':''}${h.delta}</td>
          <td>${h.stockResultante}</td>
          <td>${motLabel}</td>
          <td style="color:var(--muted2)">${h.user||'—'}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="6" class="empty">Sin movimientos de stock</td></tr>';
}

async function registrarStockHist(bebida, delta, stockResultante, motivo) {
  const entry = {ts:new Date().toISOString(), bebida, delta, stockResultante, user:cu.nombre, ...(motivo ? {motivo} : {})};
  const id = await fsAdd('stockHist', entry);
  cache.stockHist.push({id, ...entry});
}

// ─── DIRECCIÓN DEL MOVIMIENTO DE STOCK ──────────────────────────
let _stockDir = 'add'; // 'add' | 'sub'
window.setStockDir = function(dir) {
  _stockDir = dir;
  const btnAdd  = document.getElementById('stock-dir-add');
  const btnSub  = document.getElementById('stock-dir-sub');
  const motivoW = document.getElementById('stock-motivo-wrap');
  const alertaW = document.getElementById('stock-alerta-wrap');
  const btnMov  = document.getElementById('btn-stock-mov');
  if(dir === 'add') {
    btnAdd.className  = 'btn bp'; btnAdd.style.fontSize='12px'; btnAdd.style.padding='5px 14px';
    btnSub.className  = 'btn bs'; btnSub.style.fontSize='12px'; btnSub.style.padding='5px 14px';
    motivoW.style.display = 'none';
    alertaW.style.display = '';
    btnMov.textContent = 'Agregar stock';
    btnMov.className   = 'btn bp';
  } else {
    btnSub.className  = 'btn br'; btnSub.style.fontSize='12px'; btnSub.style.padding='5px 14px'; btnSub.style.border='1px solid rgba(224,85,85,.4)';
    btnAdd.className  = 'btn bs'; btnAdd.style.fontSize='12px'; btnAdd.style.padding='5px 14px';
    motivoW.style.display = '';
    alertaW.style.display = 'none';
    btnMov.textContent = 'Descontar stock';
    btnMov.className   = 'btn br';
    btnMov.style.border='1px solid rgba(224,85,85,.4)';
  }
};

window.moverStock = async function() {
  const bebId  = document.getElementById('stock-beb2').value;
  const cant   = Number(document.getElementById('stock-cant2').value);
  const alerta = Number(document.getElementById('stock-alerta2').value);
  if(!bebId || !cant || cant <= 0) { toast('Seleccioná bebida y una cantidad válida','err'); return; }
  const beb = cache.bebidas.find(b=>b.id===bebId);
  if(!beb) return;

  if(_stockDir === 'sub') {
    // DESCUENTO — sin registrar como venta
    const motivo = document.getElementById('stock-motivo').value;
    const actual = beb.stock||0;
    if(cant > actual) { toast(`No hay suficiente stock (quedan ${actual})`, 'err'); return; }
    const nuevoStock = actual - cant;
    const btn = document.getElementById('btn-stock-mov');
    btn.disabled = true;
    try {
      await fsUpdate('bebidas', bebId, { stock: nuevoStock });
      beb.stock = nuevoStock;
      await registrarStockHist(beb.nombre, -cant, nuevoStock, motivo);
      auditLog('STOCK −', `${beb.nombre} −${cant} → ${nuevoStock} (${motivo})`);
      renderStock(); renderBebcfg(); renderDashboard();
      toast(`${beb.nombre}: −${cant} → stock: ${nuevoStock}`, 'warn');
      document.getElementById('stock-cant2').value = '';
    } finally { btn.disabled = false; }
    return;
  }

  // ALTA — comportamiento original
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
  if(!requireAdmin()) return;
  const nombre = document.getElementById('ne-nombre').value.trim();
  const jornal = Number(document.getElementById('ne-jornal').value);
  if(!nombre||!jornal||jornal<=0) { toast('Completá nombre y jornal','err'); return; }
  const color = COLORS[cache.empleados.length % COLORS.length];
  const id = await fsAdd('empleados', {nombre, jornal, color});
  cache.empleados.push({id, nombre, jornal, color});
  await auditLog('NUEVO EMPLEADO', `${nombre} — ${fmt(jornal)}/día`);
  renderEmpcfg(); renderEmpleados(); fillAdlEmp(); closeM('m-emp'); toast('Empleado agregado','ok');
  ['ne-nombre','ne-jornal'].forEach(i=>document.getElementById(i).value='');
};

window.guardarSaldoInicial = async function() {
  if(!requireAdmin()) return;
  const monto = Number(document.getElementById('cfg-saldo').value);
  const fecha = document.getElementById('cfg-saldo-fecha').value || hoy();
  if(!monto||monto<=0) { toast('Ingresá un monto válido','err'); return; }

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
  if(!requireAdmin()) return;
  if(!confirm('¿Eliminar empleado?')) return;
  const e = cache.empleados.find(x=>x.id===id);
  await fsDel('empleados', id);
  cache.empleados = cache.empleados.filter(x=>x.id!==id);
  auditLog('ELIMINAR EMPLEADO', e?.nombre||id);
  renderEmpcfg(); renderEmpleados(); fillAdlEmp(); toast('Eliminado','ok');
};

// ─── RECIBOS ────────────────────────────────────────────────────
let _logoDataUrl = '';

// Cargar logo como base64 para embeber en el PDF imprimible
(async function() {
  try {
    const res  = await fetch('logo.png');
    const blob = await res.blob();
    _logoDataUrl = await new Promise(r => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsDataURL(blob);
    });
  } catch(e) { _logoDataUrl = ''; }
})();

function _rcbPeekNum() {
  return String(parseInt(localStorage.getItem('titan_rcb_num')||'0') + 1).padStart(4,'0');
}
function _rcbNextNum() {
  const n = parseInt(localStorage.getItem('titan_rcb_num')||'0') + 1;
  localStorage.setItem('titan_rcb_num', n);
  return String(n).padStart(4,'0');
}

function renderRecibos() {
  const sel = document.getElementById('rcb-servicio');
  if(!sel) return;
  const opts = sortServicios(cache.servicios)
    .map(s=>`<option value="${s.id}" data-precio="${s.precio}">${sanitize(s.nombre)} — ${fmt(s.precio)}</option>`)
    .join('');
  sel.innerHTML = `<option value="">— Seleccionar servicio —</option>${opts}<option value="custom">✏️ Ingresar manualmente</option>`;
  if(!document.getElementById('rcb-fecha').value) {
    document.getElementById('rcb-fecha').value = hoy();
    document.getElementById('rcb-numero').value = _rcbPeekNum();
  }
  updateReciboPreview();
}

window.onReciboServicioChange = function() {
  const sel = document.getElementById('rcb-servicio');
  const opt = sel.options[sel.selectedIndex];
  if(opt.value && opt.value !== 'custom') {
    const srv = cache.servicios.find(s=>s.id===opt.value);
    if(srv) {
      document.getElementById('rcb-detalle').value = srv.nombre;
      document.getElementById('rcb-importe').value = srv.precio;
    }
  } else if(opt.value === 'custom') {
    document.getElementById('rcb-detalle').value = '';
    document.getElementById('rcb-importe').value = '';
    document.getElementById('rcb-detalle').focus();
  }
  updateReciboPreview();
};

window.updateReciboPreview = function() {
  const v = id => document.getElementById(id)?.value || '';
  const html = _buildReciboHTML({
    fecha:   v('rcb-fecha') || hoy(),
    numero:  v('rcb-numero') || '—',
    cliente: v('rcb-cliente').trim() || '—',
    dni:     v('rcb-dni').trim(),
    detalle: v('rcb-detalle').trim() || '—',
    patente: v('rcb-patente').trim().toUpperCase(),
    importe: Number(v('rcb-importe')) || 0,
    pago:    v('rcb-pago') || 'Efectivo',
    logo:    _logoDataUrl
  });
  const preview = document.getElementById('recibo-preview');
  if(preview) preview.innerHTML = html;
};

function _buildReciboHTML({fecha, numero, cliente, dni, detalle, patente, importe, pago, logo}) {
  const logoTag = logo
    ? `<img src="${logo}" style="width:72px;height:72px;object-fit:contain;">`
    : `<div style="font-size:28px;font-weight:900;color:#00c4d4;">TITAN</div>`;
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;line-height:1.5;">
    <!-- Encabezado -->
    <div style="text-align:center;padding-bottom:14px;margin-bottom:14px;border-bottom:3px solid #00c4d4;">
      ${logoTag}
      <div style="font-size:19px;font-weight:900;letter-spacing:1px;color:#141b24;margin-top:6px;">TITAN CAR WASH</div>
      <div style="font-size:10px;color:#888;margin-top:1px;">Lavadero de Autos</div>
      <div style="font-size:15px;font-weight:700;color:#00c4d4;letter-spacing:3px;margin-top:8px;">RECIBO DE PAGO</div>
    </div>
    <!-- N° y fecha -->
    <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-size:12px;color:#444;">
      <span><b>N° Recibo:</b> ${sanitize(numero)}</span>
      <span><b>Fecha:</b> ${fmtDL(fecha)}</span>
    </div>
    <!-- Cliente -->
    <div style="border:1px solid #ddd;border-radius:5px;padding:10px 12px;margin-bottom:12px;">
      <div style="font-size:9px;font-weight:700;color:#aaa;letter-spacing:.8px;margin-bottom:6px;">CLIENTE</div>
      <div><b>Nombre:</b> ${sanitize(cliente)}</div>
      ${dni ? `<div style="margin-top:3px;"><b>DNI / CUIT:</b> ${sanitize(dni)}</div>` : ''}
    </div>
    <!-- Servicio -->
    <div style="border:1px solid #ddd;border-radius:5px;padding:10px 12px;margin-bottom:14px;">
      <div style="font-size:9px;font-weight:700;color:#aaa;letter-spacing:.8px;margin-bottom:6px;">DETALLE DEL SERVICIO</div>
      <div>${sanitize(detalle)}</div>
      ${patente ? `<div style="margin-top:4px;color:#555;">Patente: <b>${sanitize(patente)}</b></div>` : ''}
      <div style="margin-top:4px;color:#555;">Forma de pago: <b>${sanitize(pago)}</b></div>
    </div>
    <!-- Total -->
    <div style="background:#141b24;border-radius:6px;padding:14px;text-align:center;margin-bottom:18px;">
      <div style="font-size:10px;color:rgba(255,255,255,.55);letter-spacing:.8px;margin-bottom:4px;">TOTAL ABONADO</div>
      <div style="font-size:30px;font-weight:900;color:#00c4d4;">${fmt(importe)}</div>
    </div>
    <!-- Firmas -->
    <div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:24px;">
      <div style="width:44%;text-align:center;">
        <div style="border-top:1px solid #bbb;padding-top:5px;font-size:10px;color:#888;">Firma y Sello</div>
      </div>
      <div style="width:44%;text-align:center;">
        <div style="border-top:1px solid #bbb;padding-top:5px;font-size:10px;color:#888;">Recibí conforme</div>
      </div>
    </div>
    <!-- Pie -->
    <div style="text-align:center;margin-top:18px;padding-top:10px;border-top:1px solid #eee;font-size:10px;color:#aaa;">
      Titan Car Wash — Gracias por su visita
    </div>
  </div>`;
}

window.imprimirRecibo = function() {
  const v = id => document.getElementById(id)?.value || '';
  // Consumir número solo al imprimir
  const numActual = v('rcb-numero');
  if(numActual === _rcbPeekNum()) {
    _rcbNextNum(); // confirmar consumo
  }
  const html = _buildReciboHTML({
    fecha:   v('rcb-fecha') || hoy(),
    numero:  numActual || '—',
    cliente: v('rcb-cliente').trim() || '—',
    dni:     v('rcb-dni').trim(),
    detalle: v('rcb-detalle').trim() || '—',
    patente: v('rcb-patente').trim().toUpperCase(),
    importe: Number(v('rcb-importe')) || 0,
    pago:    v('rcb-pago') || 'Efectivo',
    logo:    _logoDataUrl
  });
  const win = window.open('', '_blank', 'width=640,height=860');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Recibo ${sanitize(numActual)} — Titan Car Wash</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #fff; padding: 32px; }
      @media print {
        body { padding: 0; }
        @page { margin: 1.5cm; size: A5 portrait; }
      }
    </style>
  </head><body>
    <div style="max-width:420px;margin:0 auto;">${html}</div>
    <script>
      window.onload = function() { setTimeout(function(){ window.print(); }, 300); };
    <\/script>
  </body></html>`);
  win.document.close();
  auditLog('RECIBO', `N°${numActual} — ${v('rcb-cliente')||'sin cliente'} — ${fmt(Number(v('rcb-importe'))||0)}`);
};

window.compartirRecibo = function() {
  const v    = id => document.getElementById(id)?.value || '';
  const num  = v('rcb-numero') || '—';
  const cli  = v('rcb-cliente').trim() || 'Cliente';
  const det  = v('rcb-detalle').trim() || '—';
  const imp  = Number(v('rcb-importe')) || 0;
  const fec  = v('rcb-fecha') || hoy();
  const subj = `Recibo N° ${num} — Titan Car Wash`;
  const body = `Estimado/a ${cli},\n\nAdjuntamos su recibo de pago:\n\n` +
    `N° Recibo: ${num}\nFecha: ${fmtDL(fec)}\nServicio: ${det}\nTotal abonado: ${fmt(imp)}\n\n` +
    `Gracias por elegirnos.\n\nTitan Car Wash`;
  window.location.href = `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
  toast('Abriendo email — adjuntá el PDF que generaste','ok');
};

window.limpiarRecibo = function() {
  ['rcb-cliente','rcb-dni','rcb-detalle','rcb-patente','rcb-importe'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  document.getElementById('rcb-servicio').value = '';
  document.getElementById('rcb-pago').value = 'Efectivo';
  document.getElementById('rcb-fecha').value = hoy();
  document.getElementById('rcb-numero').value = _rcbNextNum();
  updateReciboPreview();
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
  // Bloquear en producción — no puede ejecutarse desde DevTools en GitHub Pages
  if(!isDev) {
    console.warn('devLogin solo disponible en entorno local');
    return;
  }
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
