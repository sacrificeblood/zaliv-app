const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(express.json());

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        plan_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sources (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        key_link TEXT DEFAULT '',
        position INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE,
        source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
        geo VARCHAR(50) NOT NULL,
        creative VARCHAR(255) NOT NULL,
        assistant VARCHAR(100) DEFAULT '',
        platform VARCHAR(10) NOT NULL DEFAULT 'android',
        neyming TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('DB initialized');
  } finally {
    client.release();
  }
}

app.get('/api/plans', async (req, res) => {
  const r = await pool.query('SELECT * FROM plans ORDER BY plan_date DESC, created_at DESC');
  res.json(r.rows);
});
app.post('/api/plans', async (req, res) => {
  const { name, plan_date } = req.body;
  const r = await pool.query('INSERT INTO plans(name, plan_date) VALUES($1,$2) RETURNING *', [name, plan_date]);
  res.json(r.rows[0]);
});
app.delete('/api/plans/:id', async (req, res) => {
  await pool.query('DELETE FROM plans WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});
app.patch('/api/plans/:id', async (req, res) => {
  const { name, plan_date } = req.body;
  const r = await pool.query('UPDATE plans SET name=$1, plan_date=$2 WHERE id=$3 RETURNING *', [name, plan_date, req.params.id]);
  res.json(r.rows[0]);
});

app.get('/api/plans/:id/sources', async (req, res) => {
  const r = await pool.query('SELECT * FROM sources WHERE plan_id=$1 ORDER BY position,id', [req.params.id]);
  res.json(r.rows);
});
app.post('/api/plans/:id/sources', async (req, res) => {
  const { name, key_link } = req.body;
  const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM sources WHERE plan_id=$1', [req.params.id]);
  const r = await pool.query('INSERT INTO sources(plan_id,name,key_link,position) VALUES($1,$2,$3,$4) RETURNING *',
    [req.params.id, name, key_link||'', pos.rows[0].p]);
  res.json(r.rows[0]);
});
app.patch('/api/sources/:id', async (req, res) => {
  const r = await pool.query('UPDATE sources SET name=$1,key_link=$2 WHERE id=$3 RETURNING *',
    [req.body.name, req.body.key_link||'', req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/sources/:id', async (req, res) => {
  await pool.query('DELETE FROM sources WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/plans/:id/campaigns', async (req, res) => {
  const r = await pool.query(
    'SELECT c.*, s.name as source_name FROM campaigns c LEFT JOIN sources s ON c.source_id=s.id WHERE c.plan_id=$1 ORDER BY c.platform DESC, c.position, c.id',
    [req.params.id]);
  res.json(r.rows);
});
app.post('/api/campaigns', async (req, res) => {
  const { plan_id, source_id, geo, creative, assistant, platform, neyming } = req.body;
  const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM campaigns WHERE plan_id=$1 AND source_id=$2', [plan_id, source_id]);
  const r = await pool.query(
    'INSERT INTO campaigns(plan_id,source_id,geo,creative,assistant,platform,neyming,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [plan_id, source_id, geo, creative, assistant||'', platform, neyming, pos.rows[0].p]);
  res.json(r.rows[0]);
});
app.delete('/api/campaigns/:id', async (req, res) => {
  await pool.query('DELETE FROM campaigns WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML);
});

var HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>План залива</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;font-size:13px}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#2d3248;border-radius:3px}

/* HEADER */
.hdr{background:#1a1d27;border-bottom:1px solid #2d3248;height:52px;display:flex;align-items:center;padding:0 20px;gap:16px;position:sticky;top:0;z-index:100;flex-shrink:0}
.hdr-logo{font-size:16px;font-weight:800;color:#fff;letter-spacing:-.3px}
.hdr-sep{flex:1}
.hdr-date{font-size:12px;color:#475569}

/* LAYOUT */
.layout{display:flex;height:calc(100vh - 52px);overflow:hidden}

/* SIDEBAR */
.sidebar{width:230px;min-width:230px;background:#1a1d27;border-right:1px solid #2d3248;display:flex;flex-direction:column;overflow:hidden}
.sb-head{padding:12px 12px 6px;display:flex;align-items:center;justify-content:space-between}
.sb-head-title{font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.8px}
.sb-list{flex:1;overflow-y:auto;padding:4px 6px}

/* DATE GROUP in sidebar */
.date-group{margin-bottom:4px}
.date-group-label{padding:6px 10px 3px;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:6px}
.date-badge{font-size:9px;background:#1e293b;color:#475569;padding:1px 5px;border-radius:4px;font-weight:600}
.date-badge.today{background:#3b0764;color:#c4b5fd}
.plan-item{display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:6px;cursor:pointer;color:#94a3b8;transition:background .12s;margin-bottom:1px}
.plan-item:hover{background:#252836;color:#e2e8f0}
.plan-item.active{background:#252836;color:#fff;font-weight:600}
.plan-item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.plan-del{opacity:0;color:#ef4444;font-size:15px;cursor:pointer;width:16px;text-align:center;flex-shrink:0}
.plan-item:hover .plan-del{opacity:1}
.sb-footer{padding:10px 8px;border-top:1px solid #2d3248;display:flex;flex-direction:column;gap:6px}

/* MAIN */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}

/* TOOLBAR */
.toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #2d3248;background:#1a1d27;flex-shrink:0;flex-wrap:wrap}
.plan-title{font-size:14px;font-weight:700;color:#fff;cursor:pointer}
.plan-title:hover{color:#a78bfa}
.plan-date-badge{font-size:11px;padding:2px 8px;border-radius:5px;background:#1e293b;color:#64748b;border:1px solid #2d3248}
.plan-date-badge.today{background:#3b0764;color:#c4b5fd;border-color:#6d28d9}
.toolbar-sep{flex:1}
.save-st{font-size:11px;color:#475569}

/* ADD FORM */
.add-form{background:#141720;border-bottom:1px solid #2d3248;padding:10px 16px;flex-shrink:0}
.form-row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
.fg{display:flex;flex-direction:column;gap:3px}
.fg label{font-size:10px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.fg input,.fg select{background:#0f1117;border:1px solid #2d3248;border-radius:6px;padding:6px 9px;color:#e2e8f0;font-size:12px;outline:none;font-family:inherit;transition:border-color .15s}
.fg input:focus,.fg select:focus{border-color:#6d28d9}
.fg input::placeholder{color:#2d3248}
.fg-geo{width:80px}
.fg-creative{width:130px}
.fg-assist{width:100px}
.fg-count{width:90px}
.fg-source{width:160px}
.preview-row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.preview-chip{font-size:11px;font-family:monospace;padding:3px 8px;border-radius:5px;cursor:pointer;transition:opacity .15s}
.preview-chip:hover{opacity:.7}
.preview-chip.android{background:#052e16;color:#4ade80;border:1px solid #14532d}
.preview-chip.ios{background:#0c1a3d;color:#60a5fa;border:1px solid #1e3a5f}

/* TABLE AREA */
.table-wrap{flex:1;overflow:auto;padding:0}

/* MAIN TABLE */
.ztable{border-collapse:collapse;min-width:100%;table-layout:fixed}
.ztable th{background:#1a1d27;border:1px solid #2d3248;padding:0;position:sticky;top:0;z-index:10;vertical-align:top;min-width:180px;width:200px}
.ztable th.th-num{width:40px;min-width:40px;text-align:center;font-size:11px;color:#334155;font-weight:400}
.th-inner{padding:8px 10px 6px;position:relative}
.th-src-name{font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;padding-right:18px}
.th-src-name:hover{color:#a78bfa}
.th-src-key{font-size:10px;color:#334155;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace}
.th-src-cnt{font-size:10px;color:#475569;margin-top:1px}
.th-del{position:absolute;top:4px;right:4px;opacity:0;cursor:pointer;color:#ef4444;font-size:14px;width:16px;height:16px;display:flex;align-items:center;justify-content:center;border-radius:3px}
.ztable th:hover .th-del{opacity:1}
.th-del:hover{background:#450a0a}
.th-add{background:#1a1d27;border:1px dashed #2d3248;min-width:120px;width:120px;cursor:pointer;color:#334155;font-size:12px;text-align:center;padding:10px;position:sticky;top:0;z-index:10}
.th-add:hover{color:#a78bfa;border-color:#6d28d9;background:#1e1533}

/* ROWS */
.ztable td{border:1px solid #1e293b;padding:0;vertical-align:top;background:#0f1117}
.ztable td.td-num{background:#141720;text-align:center;font-size:11px;color:#334155;cursor:pointer;user-select:none;width:40px;min-width:40px}
.ztable td.td-num:hover{color:#ef4444;background:#1a0505}
.cell-wrap{padding:4px 6px;min-height:32px}
.camp-entry{display:flex;align-items:flex-start;gap:4px;padding:2px 0;border-radius:4px;transition:background .1s;cursor:default}
.camp-entry:hover{background:#1a1d27}
.camp-platform{width:14px;height:14px;border-radius:3px;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.camp-platform.android{background:#052e16;color:#4ade80}
.camp-platform.ios{background:#0c1a3d;color:#60a5fa}
.camp-neyming{font-size:11px;font-family:monospace;color:#94a3b8;flex:1;line-height:1.4;word-break:break-all;cursor:pointer}
.camp-neyming:hover{color:#fff}
.camp-del-btn{opacity:0;color:#ef4444;cursor:pointer;font-size:13px;flex-shrink:0;line-height:1;padding:0 2px}
.camp-entry:hover .camp-del-btn{opacity:1}
.add-row-tr td{border:1px dashed #1e293b;background:transparent;text-align:center;padding:6px;cursor:pointer;color:#334155;font-size:12px}
.add-row-tr td:hover{color:#a78bfa;background:#1e1533}

/* EMPTY */
.empty-main{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#334155}
.empty-main .ico{font-size:40px}
.empty-main h2{font-size:16px;color:#475569}

/* BUTTONS */
.btn{padding:6px 12px;border-radius:7px;border:none;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.btn-primary{background:#6d28d9;color:#fff}
.btn-primary:hover{background:#7c3aed}
.btn-secondary{background:#1e293b;color:#94a3b8;border:1px solid #2d3248}
.btn-secondary:hover{background:#252836;color:#e2e8f0}
.btn-sm{padding:4px 9px;font-size:11px}
.btn-full{width:100%;justify-content:center}
.btn-ghost{background:transparent;color:#475569;border:1px solid #2d3248;padding:4px 8px;font-size:11px}
.btn-ghost:hover{background:#252836;color:#e2e8f0}

/* CALENDAR PICKER in sidebar */
.cal-wrap{padding:8px 10px}
.cal-wrap input[type=date]{background:#0f1117;border:1px solid #2d3248;border-radius:6px;padding:6px 8px;color:#e2e8f0;font-size:12px;outline:none;width:100%;cursor:pointer}
.cal-wrap input[type=date]:focus{border-color:#6d28d9}

/* MODAL */
.modal-ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;align-items:center;justify-content:center}
.modal-ov.open{display:flex}
.modal{background:#1a1d27;border:1px solid #2d3248;border-radius:12px;padding:22px;width:400px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.modal h3{font-size:14px;font-weight:700;margin-bottom:14px;color:#fff}
.modal label{font-size:10px;color:#94a3b8;display:block;margin-bottom:4px;margin-top:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.modal input,.modal textarea{width:100%;background:#0f1117;border:1px solid #2d3248;border-radius:7px;padding:7px 10px;color:#e2e8f0;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s}
.modal textarea{min-height:65px;resize:vertical;font-family:monospace;font-size:11px}
.modal input:focus,.modal textarea:focus{border-color:#6d28d9}
.modal input[type=date]{cursor:pointer}
.modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}

/* TOAST */
.toast{position:fixed;bottom:20px;right:20px;background:#1e293b;border:1px solid #2d3248;color:#e2e8f0;padding:8px 14px;border-radius:8px;font-size:12px;z-index:300;opacity:0;transform:translateY(6px);transition:all .2s;pointer-events:none}
.toast.show{opacity:1;transform:translateY(0)}
.toast.ok{border-color:#16a34a;color:#4ade80}
.toast.err{border-color:#dc2626;color:#f87171}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="hdr">
  <div class="hdr-logo">&#128640; План залива</div>
  <div class="hdr-sep"></div>
  <span class="save-st" id="save-st"></span>
  <span class="hdr-date" id="hdr-date"></span>
</div>

<div class="layout">
  <!-- SIDEBAR -->
  <div class="sidebar">
    <div class="sb-head">
      <span class="sb-head-title">Планы</span>
    </div>
    <div class="cal-wrap">
      <input type="date" id="cal-filter" title="Фильтр по дате">
    </div>
    <div class="sb-list" id="plan-list"></div>
    <div class="sb-footer">
      <button class="btn btn-primary btn-full btn-sm" id="btn-new-plan">+ Новый план</button>
    </div>
  </div>

  <!-- MAIN -->
  <div class="main" id="main">
    <div class="empty-main">
      <div class="ico">&#128203;</div>
      <h2>Выбери или создай план</h2>
    </div>
  </div>
</div>

<!-- MODAL: NEW PLAN -->
<div class="modal-ov" id="m-new-plan">
  <div class="modal">
    <h3>Новый план</h3>
    <label>Название</label>
    <input id="inp-plan-name" placeholder="Залив 12 июня">
    <label>Дата</label>
    <input type="date" id="inp-plan-date">
    <div class="modal-btns">
      <button class="btn btn-secondary" id="btn-cancel-plan">Отмена</button>
      <button class="btn btn-primary" id="btn-create-plan">Создать</button>
    </div>
  </div>
</div>

<!-- MODAL: EDIT PLAN -->
<div class="modal-ov" id="m-edit-plan">
  <div class="modal">
    <h3>Редактировать план</h3>
    <label>Название</label>
    <input id="inp-edit-plan-name">
    <label>Дата</label>
    <input type="date" id="inp-edit-plan-date">
    <div class="modal-btns">
      <button class="btn btn-secondary" id="btn-cancel-edit-plan">Отмена</button>
      <button class="btn btn-primary" id="btn-save-edit-plan">Сохранить</button>
    </div>
  </div>
</div>

<!-- MODAL: SOURCE -->
<div class="modal-ov" id="m-source">
  <div class="modal">
    <h3 id="m-src-title">Новый источник</h3>
    <label>Название</label>
    <input id="inp-src-name" placeholder="OUR APPS CHICKEN">
    <label>Ключ / ссылка (необязательно)</label>
    <textarea id="inp-src-key" placeholder="bndrnt000612&amp;key=..."></textarea>
    <div class="modal-btns">
      <button class="btn btn-secondary" id="btn-cancel-src">Отмена</button>
      <button class="btn btn-primary" id="btn-save-src">Сохранить</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
var plans = [], curPlanId = null, sources = [], campaigns = [], editSrcId = null, filterDate = null;
var _tt;

// ---- UTILS ----
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function setSt(msg) { var el = document.getElementById('save-st'); if(el) el.textContent = msg; }
function toast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show' + (type ? ' '+type : '');
  clearTimeout(_tt); _tt = setTimeout(function(){ el.classList.remove('show'); }, 2500);
}
async function api(url, method, body) {
  method = method || 'GET';
  var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  var r = await fetch(url, opts);
  if (!r.ok) throw new Error(await r.text());
  if (method === 'DELETE') return null;
  return r.json();
}

// Киевское время
function kievToday() {
  var now = new Date();
  var kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kiev' }));
  var y = kyiv.getFullYear();
  var m = String(kyiv.getMonth()+1).padStart(2,'0');
  var d = String(kyiv.getDate()).padStart(2,'0');
  return y + '-' + m + '-' + d;
}

function isToday(dateStr) {
  return dateStr === kievToday();
}

function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  var today = kievToday();
  var parts = dateStr.split('-');
  var label = parts[2] + '.' + parts[1] + '.' + parts[0];
  if (dateStr === today) return label + ' (сегодня)';
  // yesterday
  var d = new Date(dateStr + 'T12:00:00');
  var t = new Date(today + 'T12:00:00');
  var diff = Math.round((t - d) / 86400000);
  if (diff === 1) return label + ' (вчера)';
  return label;
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', function() {
  // set header date
  var el = document.getElementById('hdr-date');
  if (el) el.textContent = formatDateLabel(kievToday());

  // set default date for new plan input
  document.getElementById('inp-plan-date').value = kievToday();

  // calendar filter
  var cal = document.getElementById('cal-filter');
  cal.addEventListener('change', function() {
    filterDate = cal.value || null;
    renderSidebar();
  });

  // modal buttons
  document.getElementById('btn-new-plan').onclick = function() {
    document.getElementById('inp-plan-name').value = '';
    document.getElementById('inp-plan-date').value = kievToday();
    openModal('m-new-plan');
    setTimeout(function(){ document.getElementById('inp-plan-name').focus(); }, 50);
  };
  document.getElementById('btn-cancel-plan').onclick = function(){ closeModal('m-new-plan'); };
  document.getElementById('btn-create-plan').onclick = createPlan;
  document.getElementById('btn-cancel-edit-plan').onclick = function(){ closeModal('m-edit-plan'); };
  document.getElementById('btn-save-edit-plan').onclick = saveEditPlan;
  document.getElementById('btn-cancel-src').onclick = function(){ closeModal('m-source'); };
  document.getElementById('btn-save-src').onclick = saveSource;

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') document.querySelectorAll('.modal-ov.open').forEach(function(m){ m.classList.remove('open'); });
    if (e.key === 'Enter' && !e.target.matches('textarea') && !e.target.matches('input[type=date]')) {
      var mo = e.target.closest('.modal-ov');
      if (mo) { var btn = mo.querySelector('.btn-primary'); if(btn) btn.click(); }
    }
  });

  loadPlans();
});

// ---- PLANS ----
async function loadPlans() {
  plans = await api('/api/plans');
  renderSidebar();
  // auto-select today's plan or first
  var today = kievToday();
  var todayPlan = plans.find(function(p){ return p.plan_date && p.plan_date.slice(0,10) === today; });
  var toSelect = todayPlan || (plans.length ? plans[0] : null);
  if (toSelect) selectPlan(toSelect.id);
}

function renderSidebar() {
  var list = document.getElementById('plan-list');
  // group by date
  var filtered = filterDate ? plans.filter(function(p){ return p.plan_date && p.plan_date.slice(0,10) === filterDate; }) : plans;

  // group
  var groups = {};
  filtered.forEach(function(p) {
    var d = p.plan_date ? p.plan_date.slice(0,10) : 'unknown';
    if (!groups[d]) groups[d] = [];
    groups[d].push(p);
  });

  var dates = Object.keys(groups).sort(function(a,b){ return b.localeCompare(a); });
  var html = '';
  dates.forEach(function(d) {
    var todayBadge = isToday(d) ? ' today' : '';
    html += '<div class="date-group">';
    html += '<div class="date-group-label"><span>' + formatDateLabel(d) + '</span></div>';
    groups[d].forEach(function(p) {
      html += '<div class="plan-item' + (p.id===curPlanId?' active':'') + '" data-id="' + p.id + '">' +
        '<span class="plan-item-name">' + esc(p.name) + '</span>' +
        '<span class="plan-del" data-del="' + p.id + '">&times;</span>' +
        '</div>';
    });
    html += '</div>';
  });

  if (!filtered.length) {
    html = '<div style="padding:16px;text-align:center;color:#334155;font-size:12px">' +
      (filterDate ? 'Нет планов за эту дату' : 'Нет планов') + '</div>';
  }

  list.innerHTML = html;
  list.querySelectorAll('.plan-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (!e.target.matches('.plan-del')) selectPlan(parseInt(item.dataset.id));
    });
  });
  list.querySelectorAll('.plan-del').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation(); deletePlan(parseInt(btn.dataset.del));
    });
  });
}

async function createPlan() {
  var name = document.getElementById('inp-plan-name').value.trim();
  var plan_date = document.getElementById('inp-plan-date').value || kievToday();
  if (!name) return;
  var p = await api('/api/plans', 'POST', { name: name, plan_date: plan_date });
  plans.unshift(p);
  closeModal('m-new-plan');
  renderSidebar();
  selectPlan(p.id);
  toast('План создан', 'ok');
}

async function deletePlan(id) {
  if (!confirm('Удалить план?')) return;
  await api('/api/plans/'+id, 'DELETE');
  plans = plans.filter(function(p){ return p.id !== id; });
  if (curPlanId === id) { curPlanId = null; sources = []; campaigns = []; renderMain(); }
  renderSidebar();
}

function openEditPlan() {
  var p = plans.find(function(x){ return x.id === curPlanId; });
  if (!p) return;
  document.getElementById('inp-edit-plan-name').value = p.name;
  document.getElementById('inp-edit-plan-date').value = p.plan_date ? p.plan_date.slice(0,10) : kievToday();
  openModal('m-edit-plan');
  setTimeout(function(){ document.getElementById('inp-edit-plan-name').focus(); }, 50);
}

async function saveEditPlan() {
  var name = document.getElementById('inp-edit-plan-name').value.trim();
  var plan_date = document.getElementById('inp-edit-plan-date').value || kievToday();
  if (!name) return;
  var p = await api('/api/plans/'+curPlanId, 'PATCH', { name: name, plan_date: plan_date });
  var i = plans.findIndex(function(x){ return x.id === curPlanId; });
  if (i !== -1) plans[i] = p;
  closeModal('m-edit-plan');
  renderSidebar();
  renderToolbar();
  toast('Сохранено', 'ok');
}

async function selectPlan(id) {
  curPlanId = id;
  renderSidebar();
  document.getElementById('main').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#475569">Загрузка...</div>';
  var res = await Promise.all([api('/api/plans/'+id+'/sources'), api('/api/plans/'+id+'/campaigns')]);
  sources = res[0]; campaigns = res[1];
  renderMain();
}

// ---- SOURCES ----
function openNewSource() {
  editSrcId = null;
  document.getElementById('m-src-title').textContent = 'Новый источник';
  document.getElementById('inp-src-name').value = '';
  document.getElementById('inp-src-key').value = '';
  openModal('m-source');
  setTimeout(function(){ document.getElementById('inp-src-name').focus(); }, 50);
}
function openEditSource(id) {
  var s = sources.find(function(x){ return x.id === id; });
  if (!s) return;
  editSrcId = id;
  document.getElementById('m-src-title').textContent = 'Редактировать источник';
  document.getElementById('inp-src-name').value = s.name;
  document.getElementById('inp-src-key').value = s.key_link||'';
  openModal('m-source');
  setTimeout(function(){ document.getElementById('inp-src-name').focus(); }, 50);
}
async function saveSource() {
  var name = document.getElementById('inp-src-name').value.trim();
  var key_link = document.getElementById('inp-src-key').value.trim();
  if (!name) return;
  if (editSrcId) {
    var s = await api('/api/sources/'+editSrcId, 'PATCH', { name: name, key_link: key_link });
    var i = sources.findIndex(function(x){ return x.id === editSrcId; });
    if (i !== -1) sources[i] = s;
  } else {
    var s = await api('/api/plans/'+curPlanId+'/sources', 'POST', { name: name, key_link: key_link });
    sources.push(s);
  }
  closeModal('m-source');
  renderMain();
  toast('Сохранено', 'ok');
}
async function deleteSource(id) {
  if (!confirm('Удалить источник?')) return;
  await api('/api/sources/'+id, 'DELETE');
  sources = sources.filter(function(s){ return s.id !== id; });
  campaigns = campaigns.filter(function(c){ return c.source_id !== id; });
  renderMain();
}

// ---- NEYMING ----
function buildNeyming(geo, creative, assistant, platform) {
  var parts = [geo, creative, 'm1non'];
  if (assistant) parts.push(assistant);
  if (platform === 'ios') parts.push('IOS');
  parts.push('{{random.digits.5}}');
  parts.push('{{date}}');
  return parts.join('x');
}

function parseCount(raw) {
  var upper = (raw||'').toUpperCase().replace(/\s/g,'');
  if (!upper) return null;
  // "2IOS"
  if (upper.length > 3 && upper.slice(-3) === 'IOS' && /^\d+IOS$/.test(upper)) {
    return { android: 0, ios: parseInt(upper) };
  }
  // "2+3IOS" or "2+3"
  if (upper.indexOf('+') !== -1) {
    var parts = upper.split('+');
    return { android: parseInt(parts[0])||0, ios: parseInt(parts[1])||0 };
  }
  // "2"
  if (/^\d+$/.test(upper)) return { android: parseInt(upper), ios: 0 };
  return null;
}

function updatePreview() {
  var geo = (document.getElementById('fg-geo')||{}).value||'';
  var creative = (document.getElementById('fg-creative')||{}).value||'';
  var assistant = (document.getElementById('fg-assist')||{}).value||'';
  var raw = (document.getElementById('fg-count')||{}).value||'';
  var prev = document.getElementById('preview-row');
  if (!prev) return;
  if (!geo || !creative || !raw) { prev.innerHTML=''; return; }
  var counts = parseCount(raw);
  if (!counts) { prev.innerHTML=''; return; }
  var html = '';
  for (var i=0;i<counts.android;i++) {
    var n = buildNeyming(geo.trim(), creative.trim(), assistant.trim(), 'android');
    html += '<span class="preview-chip android" data-n="'+esc(n)+'" title="Нажми чтобы скопировать">A: '+esc(n)+'</span>';
  }
  for (var i=0;i<counts.ios;i++) {
    var n = buildNeyming(geo.trim(), creative.trim(), assistant.trim(), 'ios');
    html += '<span class="preview-chip ios" data-n="'+esc(n)+'" title="Нажми чтобы скопировать">I: '+esc(n)+'</span>';
  }
  prev.innerHTML = html;
  prev.querySelectorAll('.preview-chip').forEach(function(chip) {
    chip.onclick = function(){ navigator.clipboard.writeText(chip.dataset.n).then(function(){ toast('Скопировано','ok'); }); };
  });
}

async function addCampaigns() {
  var geo = document.getElementById('fg-geo').value.trim();
  var creative = document.getElementById('fg-creative').value.trim();
  var assistant = document.getElementById('fg-assist').value.trim();
  var raw = document.getElementById('fg-count').value.trim();
  var srcEl = document.getElementById('fg-source');
  var srcId = srcEl ? parseInt(srcEl.value) : null;
  if (!geo||!creative||!raw) { toast('Заполни ГЕО, крео и количество','err'); return; }
  if (!srcId) { toast('Создай источник сначала','err'); return; }
  var counts = parseCount(raw);
  if (!counts || (counts.android===0 && counts.ios===0)) { toast('Неверный формат: используй 2, 2+3IOS или 3IOS','err'); return; }

  var toAdd = [];
  for (var i=0;i<counts.android;i++) {
    var n = buildNeyming(geo, creative, assistant, 'android');
    if (campaigns.some(function(c){ return c.neyming===n; })) { toast('Дубликат: '+n,'err'); continue; }
    toAdd.push({ geo:geo, creative:creative, assistant:assistant, platform:'android', neyming:n });
  }
  for (var i=0;i<counts.ios;i++) {
    var n = buildNeyming(geo, creative, assistant, 'ios');
    if (campaigns.some(function(c){ return c.neyming===n; })) { toast('Дубликат: '+n,'err'); continue; }
    toAdd.push({ geo:geo, creative:creative, assistant:assistant, platform:'ios', neyming:n });
  }
  if (!toAdd.length) return;

  setSt('Сохранение...');
  for (var j=0;j<toAdd.length;j++) {
    var saved = await api('/api/campaigns','POST', Object.assign({ plan_id:curPlanId, source_id:srcId }, toAdd[j]));
    saved.source_name = (sources.find(function(s){ return s.id===srcId; })||{}).name||'';
    campaigns.push(saved);
  }
  setSt('Сохранено ✓'); setTimeout(function(){ setSt(''); },2000);
  document.getElementById('fg-count').value = '';
  document.getElementById('preview-row').innerHTML = '';
  renderTable();
  toast('Добавлено '+toAdd.length+' кампаний','ok');
}

async function deleteCampaign(id) {
  await api('/api/campaigns/'+id,'DELETE');
  campaigns = campaigns.filter(function(c){ return c.id!==id; });
  renderTable();
}

// ---- RENDER ----
function renderToolbar() {
  var p = plans.find(function(x){ return x.id===curPlanId; });
  if (!p) return;
  var d = p.plan_date ? p.plan_date.slice(0,10) : '';
  var todayCls = isToday(d) ? ' today' : '';
  var el = document.getElementById('plan-toolbar');
  if (!el) return;
  el.innerHTML =
    '<span class="plan-title" id="plan-title-el">'+esc(p.name)+'</span>' +
    '<span class="plan-date-badge'+todayCls+'">'+formatDateLabel(d)+'</span>' +
    '<div class="toolbar-sep"></div>' +
    '<button class="btn btn-ghost" id="btn-edit-plan">&#9998; Редактировать</button>' +
    '<button class="btn btn-secondary btn-sm" id="btn-add-source">+ Источник</button>';
  document.getElementById('btn-edit-plan').onclick = openEditPlan;
  document.getElementById('btn-add-source').onclick = openNewSource;
}

function renderMain() {
  if (!curPlanId) {
    document.getElementById('main').innerHTML = '<div class="empty-main"><div class="ico">&#128203;</div><h2>Выбери или создай план</h2></div>';
    return;
  }
  var srcOptions = sources.map(function(s){ return '<option value="'+s.id+'">'+esc(s.name)+'</option>'; }).join('');
  document.getElementById('main').innerHTML =
    '<div class="toolbar" id="plan-toolbar"></div>' +
    '<div class="add-form">' +
      '<div class="form-row">' +
        '<div class="fg fg-geo"><label>ГЕО</label><input id="fg-geo" placeholder="CA"></div>' +
        '<div class="fg fg-creative"><label>Крео</label><input id="fg-creative" placeholder="mrbizness"></div>' +
        '<div class="fg fg-assist"><label>Ник (опц.)</label><input id="fg-assist" placeholder="burmalda"></div>' +
        '<div class="fg fg-count"><label>Кол-во</label><input id="fg-count" placeholder="2 или 2+3IOS"></div>' +
        '<div class="fg fg-source"><label>Источник</label><select id="fg-source">'+srcOptions+'</select></div>' +
        '<div class="fg" style="justify-content:flex-end"><button class="btn btn-primary" id="btn-add-camps">Добавить</button></div>' +
      '</div>' +
      '<div class="preview-row" id="preview-row"></div>' +
    '</div>' +
    '<div class="table-wrap" id="table-wrap"></div>';

  renderToolbar();

  ['fg-geo','fg-creative','fg-assist','fg-count'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreview);
  });
  document.getElementById('fg-count').addEventListener('keydown', function(e) {
    if (e.key==='Enter') addCampaigns();
  });
  document.getElementById('btn-add-camps').onclick = addCampaigns;

  renderTable();
}

function renderTable() {
  var wrap = document.getElementById('table-wrap');
  if (!wrap) return;

  if (!sources.length) {
    wrap.innerHTML = '<div style="padding:40px;text-align:center;color:#334155;font-size:13px">Добавь источник чтобы начать</div>';
    return;
  }

  // Build table: columns = sources, rows = campaigns grouped by row index
  // Find max campaigns per source
  var srcCamps = {};
  sources.forEach(function(s) {
    var android = campaigns.filter(function(c){ return c.source_id===s.id && c.platform==='android'; });
    var ios = campaigns.filter(function(c){ return c.source_id===s.id && c.platform==='ios'; });
    srcCamps[s.id] = { android: android, ios: ios };
  });

  var maxRows = 0;
  sources.forEach(function(s) {
    var total = srcCamps[s.id].android.length + srcCamps[s.id].ios.length;
    if (total > maxRows) maxRows = total;
  });

  var html = '<table class="ztable"><thead><tr>';
  html += '<th class="th-num"></th>';
  sources.forEach(function(s) {
    var total = (srcCamps[s.id].android.length + srcCamps[s.id].ios.length);
    html += '<th>' +
      '<div class="th-inner">' +
        '<span class="th-del" data-del-src="'+s.id+'">&times;</span>' +
        '<div class="th-src-name" data-edit-src="'+s.id+'">'+esc(s.name)+'</div>' +
        (s.key_link ? '<div class="th-src-key">'+esc(s.key_link)+'</div>' : '') +
        '<div class="th-src-cnt">'+total+' кампаний</div>' +
      '</div>' +
    '</th>';
  });
  html += '<th class="th-add" id="th-add-col">+ источник</th>';
  html += '</tr></thead><tbody>';

  // Rows: each row shows one campaign per source (android first, then ios)
  var maxRowCount = 0;
  sources.forEach(function(s) {
    var t = srcCamps[s.id].android.length + srcCamps[s.id].ios.length;
    if (t > maxRowCount) maxRowCount = t;
  });

  for (var i = 0; i < maxRowCount; i++) {
    html += '<tr><td class="td-num">'+(i+1)+'</td>';
    sources.forEach(function(s) {
      var allCamps = srcCamps[s.id].android.concat(srcCamps[s.id].ios);
      var c = allCamps[i];
      html += '<td><div class="cell-wrap">';
      if (c) {
        html += '<div class="camp-entry">' +
          '<div class="camp-platform '+c.platform+'">'+(c.platform==='ios'?'I':'A')+'</div>' +
          '<div class="camp-neyming" data-copy="'+esc(c.neyming)+'">'+esc(c.neyming)+'</div>' +
          '<span class="camp-del-btn" data-del-camp="'+c.id+'">&times;</span>' +
        '</div>';
      }
      html += '</div></td>';
    });
    html += '</tr>';
  }

  // Add row
  html += '<tr class="add-row-tr"><td class="td-num"></td>';
  sources.forEach(function() { html += '<td></td>'; });
  html += '<td></td></tr>';

  html += '</tbody></table>';
  wrap.innerHTML = html;

  // Events
  wrap.querySelectorAll('[data-del-src]').forEach(function(btn) {
    btn.onclick = function(e){ e.stopPropagation(); deleteSource(parseInt(btn.dataset.delSrc)); };
  });
  wrap.querySelectorAll('[data-edit-src]').forEach(function(el) {
    el.onclick = function(){ openEditSource(parseInt(el.dataset.editSrc)); };
  });
  wrap.querySelectorAll('[data-copy]').forEach(function(el) {
    el.onclick = function(){ navigator.clipboard.writeText(el.dataset.copy).then(function(){ toast('Скопировано','ok'); }); };
  });
  wrap.querySelectorAll('[data-del-camp]').forEach(function(btn) {
    btn.onclick = function(){ deleteCampaign(parseInt(btn.dataset.delCamp)); };
  });
  var addCol = document.getElementById('th-add-col');
  if (addCol) addCol.onclick = openNewSource;
}
</script>
</body>
</html>`;

initDB().then(function() {
  app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
}).catch(function(err) { console.error(err); process.exit(1); });
