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
  const r = await pool.query('SELECT * FROM plans ORDER BY created_at DESC');
  res.json(r.rows);
});
app.post('/api/plans', async (req, res) => {
  const r = await pool.query('INSERT INTO plans(name) VALUES($1) RETURNING *', [req.body.name]);
  res.json(r.rows[0]);
});
app.delete('/api/plans/:id', async (req, res) => {
  await pool.query('DELETE FROM plans WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});
app.patch('/api/plans/:id', async (req, res) => {
  const r = await pool.query('UPDATE plans SET name=$1 WHERE id=$2 RETURNING *', [req.body.name, req.params.id]);
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
    'SELECT c.*, s.name as source_name FROM campaigns c LEFT JOIN sources s ON c.source_id=s.id WHERE c.plan_id=$1 ORDER BY c.source_id, c.platform DESC, c.position, c.id',
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
  res.send(getHTML());
});

function getHTML() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>План залива</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#2d3248;border-radius:3px}
.hdr{background:#1a1d27;border-bottom:1px solid #2d3248;height:52px;display:flex;align-items:center;padding:0 20px;gap:12px;position:sticky;top:0;z-index:100}
.hdr h1{font-size:17px;font-weight:700;color:#fff}
.hdr-sep{flex:1}
.save-st{font-size:12px;color:#475569}
.layout{display:flex;height:calc(100vh - 52px)}
.sidebar{width:220px;min-width:220px;background:#1a1d27;border-right:1px solid #2d3248;display:flex;flex-direction:column}
.sb-title{padding:14px 14px 6px;font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.8px}
.sb-list{flex:1;overflow-y:auto;padding:4px 6px}
.plan-item{display:flex;align-items:center;gap:6px;padding:7px 9px;border-radius:7px;cursor:pointer;font-size:13px;color:#94a3b8;transition:background .12s}
.plan-item:hover{background:#252836;color:#e2e8f0}
.plan-item.active{background:#252836;color:#fff;font-weight:600}
.plan-item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plan-del{opacity:0;color:#ef4444;font-size:16px;cursor:pointer;width:18px;text-align:center;flex-shrink:0}
.plan-item:hover .plan-del{opacity:1}
.sb-footer{padding:10px 6px;border-top:1px solid #2d3248}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #2d3248;background:#1a1d27;flex-shrink:0;flex-wrap:wrap}
.plan-title{font-size:15px;font-weight:700;color:#fff;cursor:pointer;flex:1;min-width:100px}
.plan-title:hover{color:#a78bfa}
.content{flex:1;overflow:auto;padding:16px}
.add-form{background:#1a1d27;border:1px solid #2d3248;border-radius:10px;padding:16px;margin-bottom:16px}
.add-form h3{font-size:12px;font-weight:700;color:#a78bfa;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
.form-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.form-group{display:flex;flex-direction:column;gap:4px}
.form-group label{font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.form-group input,.form-group select{background:#0f1117;border:1px solid #2d3248;border-radius:7px;padding:7px 10px;color:#e2e8f0;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s;min-width:0}
.form-group input:focus,.form-group select:focus{border-color:#6d28d9}
.form-group input::placeholder{color:#334155}
.fg-geo{width:90px}
.fg-creative{flex:1;min-width:130px}
.fg-assist{width:110px}
.fg-count{width:90px}
.fg-source{flex:1;min-width:140px}
.parse-preview{margin-top:12px;padding:10px 12px;background:#0f1117;border-radius:7px;border:1px solid #1e293b;font-size:12px;font-family:monospace;color:#64748b;line-height:1.7;display:none}
.parse-preview.show{display:block}
.preview-android{color:#34d399}
.preview-ios{color:#60a5fa}
.preview-label{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;font-family:sans-serif;font-weight:700}
.table-section{background:#1a1d27;border:1px solid #2d3248;border-radius:10px;overflow:hidden;margin-bottom:12px}
.ts-hdr{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#141720;border-bottom:1px solid #2d3248}
.ts-hdr-name{font-size:13px;font-weight:700;color:#fff;flex:1}
.ts-hdr-key{font-size:11px;color:#475569;font-family:monospace;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ts-cnt{font-size:11px;background:#252836;color:#94a3b8;padding:2px 7px;border-radius:10px}
.ts-actions{display:flex;gap:5px}
.platform-group{margin-bottom:2px}
.platform-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;padding:5px 10px 2px;color:#475569}
.platform-label.android{color:#34d399}
.platform-label.ios{color:#60a5fa}
.camp-row{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;transition:background .1s}
.camp-row:hover{background:#252836}
.camp-neyming{flex:1;font-size:12px;font-family:monospace;color:#cbd5e1;word-break:break-all;cursor:pointer}
.camp-neyming:hover{color:#fff}
.camp-del{opacity:0;color:#ef4444;cursor:pointer;font-size:16px;width:20px;text-align:center;flex-shrink:0}
.camp-copy{opacity:0;color:#6d28d9;cursor:pointer;font-size:14px;width:20px;text-align:center;flex-shrink:0}
.camp-row:hover .camp-del,.camp-row:hover .camp-copy{opacity:1}
.empty-source{padding:14px;text-align:center;color:#334155;font-size:13px}
.empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#334155;gap:10px}
.empty-state .ico{font-size:44px}
.empty-state h2{font-size:17px;color:#475569;font-weight:600}
.btn{padding:7px 13px;border-radius:7px;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.btn-primary{background:#6d28d9;color:#fff}
.btn-primary:hover{background:#7c3aed}
.btn-secondary{background:#1e293b;color:#94a3b8;border:1px solid #2d3248}
.btn-secondary:hover{background:#252836;color:#e2e8f0}
.btn-sm{padding:5px 9px;font-size:12px}
.btn-full{width:100%;justify-content:center}
.btn-icon{padding:4px 8px;background:transparent;border:1px solid #2d3248;color:#64748b;font-size:12px}
.btn-icon:hover{background:#252836;color:#e2e8f0}
.btn-danger{background:transparent;border:1px solid #7f1d1d;color:#f87171;padding:4px 8px;font-size:12px}
.btn-danger:hover{background:#450a0a}
.sources-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid #2d3248;background:#141720}
.src-chip{padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid #2d3248;color:#64748b;transition:all .15s;display:flex;align-items:center;gap:4px}
.src-chip:hover{border-color:#6d28d9;color:#a78bfa}
.src-chip.sel{background:#3b0764;border-color:#7c3aed;color:#e9d5ff;font-weight:600}
.modal-ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;align-items:center;justify-content:center}
.modal-ov.open{display:flex}
.modal{background:#1a1d27;border:1px solid #2d3248;border-radius:12px;padding:22px;width:400px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.modal h3{font-size:15px;font-weight:700;margin-bottom:14px;color:#fff}
.modal label{font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;margin-top:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.modal input,.modal textarea{width:100%;background:#0f1117;border:1px solid #2d3248;border-radius:7px;padding:8px 11px;color:#e2e8f0;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s}
.modal textarea{min-height:70px;resize:vertical;font-family:monospace;font-size:12px}
.modal input:focus,.modal textarea:focus{border-color:#6d28d9}
.modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
.toast{position:fixed;bottom:20px;right:20px;background:#1e293b;border:1px solid #2d3248;color:#e2e8f0;padding:9px 14px;border-radius:8px;font-size:13px;z-index:300;opacity:0;transform:translateY(6px);transition:all .2s;pointer-events:none}
.toast.show{opacity:1;transform:translateY(0)}
.toast.ok{border-color:#16a34a;color:#4ade80}
.toast.err{border-color:#dc2626;color:#f87171}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="hdr">
  <h1>&#128640; План залива</h1>
  <div class="hdr-sep"></div>
  <span class="save-st" id="save-st"></span>
</div>
<div class="layout">
  <div class="sidebar">
    <div class="sb-title">Планы</div>
    <div class="sb-list" id="plan-list"></div>
    <div class="sb-footer">
      <button class="btn btn-primary btn-full btn-sm" id="btn-new-plan">+ Новый план</button>
    </div>
  </div>
  <div class="main" id="main">
    <div class="empty-state">
      <div class="ico">&#128203;</div>
      <h2>Выбери или создай план</h2>
    </div>
  </div>
</div>

<div class="modal-ov" id="m-new-plan">
  <div class="modal">
    <h3>Новый план</h3>
    <label>Название</label>
    <input id="inp-plan-name" placeholder="например: 12 июня">
    <div class="modal-btns">
      <button class="btn btn-secondary" id="btn-cancel-plan">Отмена</button>
      <button class="btn btn-primary" id="btn-create-plan">Создать</button>
    </div>
  </div>
</div>

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

<div class="modal-ov" id="m-rename">
  <div class="modal">
    <h3>Переименовать план</h3>
    <label>Название</label>
    <input id="inp-rename">
    <div class="modal-btns">
      <button class="btn btn-secondary" id="btn-cancel-rename">Отмена</button>
      <button class="btn btn-primary" id="btn-save-rename">Сохранить</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
var plans = [], curPlanId = null, sources = [], campaigns = [], editSrcId = null, selSrcId = null;
var _toastTimer;

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function setSt(msg) { var el = document.getElementById('save-st'); if(el) el.textContent = msg; }

function toast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2500);
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

// ---- MODAL BUTTONS ----
document.getElementById('btn-new-plan').onclick = function() {
  document.getElementById('inp-plan-name').value = '';
  openModal('m-new-plan');
  setTimeout(function(){ document.getElementById('inp-plan-name').focus(); }, 50);
};
document.getElementById('btn-cancel-plan').onclick = function(){ closeModal('m-new-plan'); };
document.getElementById('btn-create-plan').onclick = createPlan;
document.getElementById('btn-cancel-src').onclick = function(){ closeModal('m-source'); };
document.getElementById('btn-save-src').onclick = saveSource;
document.getElementById('btn-cancel-rename').onclick = function(){ closeModal('m-rename'); };
document.getElementById('btn-save-rename').onclick = renamePlan;

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') document.querySelectorAll('.modal-ov.open').forEach(function(m){ m.classList.remove('open'); });
  if (e.key === 'Enter' && !e.target.matches('textarea')) {
    var mo = e.target.closest('.modal-ov');
    if (mo) { var btn = mo.querySelector('.btn-primary'); if(btn) btn.click(); }
  }
});

// ---- PLANS ----
async function loadPlans() {
  plans = await api('/api/plans');
  renderSidebar();
  if (plans.length && !curPlanId) selectPlan(plans[0].id);
}

function renderSidebar() {
  var html = '';
  plans.forEach(function(p) {
    html += '<div class="plan-item' + (p.id === curPlanId ? ' active' : '') + '" data-id="' + p.id + '">' +
      '<span class="plan-item-name">' + esc(p.name) + '</span>' +
      '<span class="plan-del" data-del="' + p.id + '">&times;</span></div>';
  });
  var el = document.getElementById('plan-list');
  el.innerHTML = html;
  el.querySelectorAll('.plan-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (!e.target.matches('.plan-del')) selectPlan(parseInt(item.dataset.id));
    });
  });
  el.querySelectorAll('.plan-del').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      deletePlan(parseInt(btn.dataset.del));
    });
  });
}

async function createPlan() {
  var name = document.getElementById('inp-plan-name').value.trim();
  if (!name) return;
  var p = await api('/api/plans', 'POST', { name: name });
  plans.unshift(p);
  closeModal('m-new-plan');
  renderSidebar();
  selectPlan(p.id);
  toast('План создан', 'ok');
}

async function deletePlan(id) {
  if (!confirm('Удалить план?')) return;
  await api('/api/plans/' + id, 'DELETE');
  plans = plans.filter(function(p){ return p.id !== id; });
  if (curPlanId === id) { curPlanId = null; sources = []; campaigns = []; renderMain(); }
  renderSidebar();
}

async function renamePlan() {
  var name = document.getElementById('inp-rename').value.trim();
  if (!name) return;
  var p = await api('/api/plans/' + curPlanId, 'PATCH', { name: name });
  var i = plans.findIndex(function(x){ return x.id === curPlanId; });
  if (i !== -1) plans[i] = p;
  closeModal('m-rename');
  renderSidebar();
  var el = document.getElementById('plan-title-el');
  if (el) el.textContent = name;
}

async function selectPlan(id) {
  curPlanId = id; selSrcId = null;
  renderSidebar();
  document.getElementById('main').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#475569">Загрузка...</div>';
  var results = await Promise.all([api('/api/plans/' + id + '/sources'), api('/api/plans/' + id + '/campaigns')]);
  sources = results[0]; campaigns = results[1];
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
  document.getElementById('inp-src-key').value = s.key_link || '';
  openModal('m-source');
  setTimeout(function(){ document.getElementById('inp-src-name').focus(); }, 50);
}

async function saveSource() {
  var name = document.getElementById('inp-src-name').value.trim();
  var key_link = document.getElementById('inp-src-key').value.trim();
  if (!name) return;
  if (editSrcId) {
    var s = await api('/api/sources/' + editSrcId, 'PATCH', { name: name, key_link: key_link });
    var i = sources.findIndex(function(x){ return x.id === editSrcId; });
    if (i !== -1) sources[i] = s;
  } else {
    var s = await api('/api/plans/' + curPlanId + '/sources', 'POST', { name: name, key_link: key_link });
    sources.push(s);
  }
  closeModal('m-source');
  renderMain();
  toast('Сохранено', 'ok');
}

async function deleteSource(id) {
  if (!confirm('Удалить источник и все его кампании?')) return;
  await api('/api/sources/' + id, 'DELETE');
  sources = sources.filter(function(s){ return s.id !== id; });
  campaigns = campaigns.filter(function(c){ return c.source_id !== id; });
  if (selSrcId === id) selSrcId = null;
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
  raw = raw.trim();
  // "3IOS" or "3ios"
  var iosOnly = raw.match(/^(\d+)\s*ios$/i);
  if (iosOnly) return { android: 0, ios: parseInt(iosOnly[1]) };
  // "2+3IOS" or "2 + 3 IOS" or just "2"
  var both = raw.match(/^(\d+)(?:\s*\+\s*(\d+)\s*(?:ios)?)?$/i);
  if (both) return { android: parseInt(both[1] || 0), ios: parseInt(both[2] || 0) };
  return null;
}

function updatePreview() {
  var geo = document.getElementById('fg-geo') ? document.getElementById('fg-geo').value.trim() : '';
  var creative = document.getElementById('fg-creative') ? document.getElementById('fg-creative').value.trim() : '';
  var assistant = document.getElementById('fg-assist') ? document.getElementById('fg-assist').value.trim() : '';
  var raw = document.getElementById('fg-count') ? document.getElementById('fg-count').value.trim() : '';
  var el = document.getElementById('preview');
  if (!el) return;

  if (!geo || !creative || !raw) { el.className = 'parse-preview'; return; }
  var counts = parseCount(raw);
  if (!counts) { el.className = 'parse-preview'; return; }

  var html = '';
  if (counts.android > 0) {
    html += '<div class="preview-label">Android (' + counts.android + ')</div>';
    for (var i = 0; i < counts.android; i++) {
      html += '<div class="preview-android">' + esc(buildNeyming(geo, creative, assistant, 'android')) + '</div>';
    }
  }
  if (counts.ios > 0) {
    if (html) html += '<div style="height:5px"></div>';
    html += '<div class="preview-label">iOS (' + counts.ios + ')</div>';
    for (var i = 0; i < counts.ios; i++) {
      html += '<div class="preview-ios">' + esc(buildNeyming(geo, creative, assistant, 'ios')) + '</div>';
    }
  }
  el.innerHTML = html;
  el.className = 'parse-preview show';
}

async function addCampaigns() {
  var geo = document.getElementById('fg-geo').value.trim();
  var creative = document.getElementById('fg-creative').value.trim();
  var assistant = document.getElementById('fg-assist').value.trim();
  var raw = document.getElementById('fg-count').value.trim();
  var srcEl = document.getElementById('fg-source');
  var srcId = srcEl ? parseInt(srcEl.value) : null;

  if (!geo || !creative || !raw) { toast('Заполни ГЕО, крео и количество', 'err'); return; }
  if (!srcId) { toast('Создай источник сначала', 'err'); return; }

  var counts = parseCount(raw);
  if (!counts || (counts.android === 0 && counts.ios === 0)) { toast('Неверный формат количества', 'err'); return; }

  var toAdd = [];
  for (var i = 0; i < counts.android; i++) {
    var n = buildNeyming(geo, creative, assistant, 'android');
    if (campaigns.some(function(c){ return c.neyming === n; })) { toast('Дубликат: ' + n, 'err'); continue; }
    toAdd.push({ geo: geo, creative: creative, assistant: assistant, platform: 'android', neyming: n });
  }
  for (var i = 0; i < counts.ios; i++) {
    var n = buildNeyming(geo, creative, assistant, 'ios');
    if (campaigns.some(function(c){ return c.neyming === n; })) { toast('Дубликат: ' + n, 'err'); continue; }
    toAdd.push({ geo: geo, creative: creative, assistant: assistant, platform: 'ios', neyming: n });
  }

  if (!toAdd.length) return;
  setSt('Сохранение...');
  for (var j = 0; j < toAdd.length; j++) {
    var saved = await api('/api/campaigns', 'POST', Object.assign({ plan_id: curPlanId, source_id: srcId }, toAdd[j]));
    saved.source_name = (sources.find(function(s){ return s.id === srcId; }) || {}).name || '';
    campaigns.push(saved);
  }
  setSt('Сохранено ✓');
  setTimeout(function(){ setSt(''); }, 2000);
  document.getElementById('fg-count').value = '';
  document.getElementById('preview').className = 'parse-preview';
  renderCampaigns();
  toast('Добавлено ' + toAdd.length + ' кампаний', 'ok');
}

async function deleteCampaign(id) {
  await api('/api/campaigns/' + id, 'DELETE');
  campaigns = campaigns.filter(function(c){ return c.id !== id; });
  renderCampaigns();
}

function copyNeyming(text) {
  navigator.clipboard.writeText(text).then(function(){ toast('Скопировано', 'ok'); });
}

function copyAllSource(srcId) {
  var list = campaigns.filter(function(c){ return c.source_id === srcId; }).map(function(c){ return c.neyming; });
  navigator.clipboard.writeText(list.join('\\n')).then(function(){ toast('Скопировано ' + list.length + ' неймингов', 'ok'); });
}

// ---- RENDER ----
function renderMain() {
  if (!curPlanId) {
    document.getElementById('main').innerHTML = '<div class="empty-state"><div class="ico">&#128203;</div><h2>Выбери или создай план</h2></div>';
    return;
  }
  var plan = plans.find(function(p){ return p.id === curPlanId; });
  var srcOptions = sources.map(function(s){ return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('');

  document.getElementById('main').innerHTML =
    '<div class="toolbar">' +
      '<span class="plan-title" id="plan-title-el">' + esc(plan ? plan.name : '') + '</span>' +
      '<button class="btn btn-secondary btn-sm" id="btn-rename-plan">&#9998; Переименовать</button>' +
      '<button class="btn btn-secondary btn-sm" id="btn-add-source">+ Источник</button>' +
    '</div>' +
    '<div class="sources-bar" id="sources-bar"></div>' +
    '<div class="content">' +
      '<div class="add-form">' +
        '<h3>&#10022; Добавить кампании</h3>' +
        '<div class="form-row">' +
          '<div class="form-group fg-geo"><label>ГЕО</label><input id="fg-geo" placeholder="CA, ROEU..."></div>' +
          '<div class="form-group fg-creative"><label>Крео</label><input id="fg-creative" placeholder="mrbizness, nalog..."></div>' +
          '<div class="form-group fg-assist"><label>Ник (опц.)</label><input id="fg-assist" placeholder="burmalda"></div>' +
          '<div class="form-group fg-count"><label>Кол-во</label><input id="fg-count" placeholder="2 или 2+3IOS"></div>' +
          '<div class="form-group fg-source"><label>Источник</label><select id="fg-source">' + srcOptions + '</select></div>' +
          '<div class="form-group" style="justify-content:flex-end"><button class="btn btn-primary" id="btn-add-camps">Добавить</button></div>' +
        '</div>' +
        '<div class="parse-preview" id="preview"></div>' +
      '</div>' +
      '<div id="campaigns-area"></div>' +
    '</div>';

  document.getElementById('btn-rename-plan').onclick = function() {
    var p = plans.find(function(x){ return x.id === curPlanId; });
    document.getElementById('inp-rename').value = p ? p.name : '';
    openModal('m-rename');
    setTimeout(function(){ document.getElementById('inp-rename').focus(); }, 50);
  };
  document.getElementById('btn-add-source').onclick = openNewSource;
  document.getElementById('btn-add-camps').onclick = addCampaigns;

  ['fg-geo','fg-creative','fg-assist','fg-count'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreview);
  });
  document.getElementById('fg-count').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addCampaigns();
  });

  renderSourcesBar();
  renderCampaigns();
}

function renderSourcesBar() {
  var bar = document.getElementById('sources-bar');
  if (!bar) return;
  var html = '<span style="font-size:11px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0">Источники:</span>';
  sources.forEach(function(s) {
    html += '<div class="src-chip' + (selSrcId === s.id ? ' sel' : '') + '" data-sid="' + s.id + '">' + esc(s.name) + '</div>';
  });
  html += '<button class="btn btn-icon btn-sm" id="sb-add-src">+</button>';
  if (selSrcId) html += '<button class="btn btn-secondary btn-sm" id="sb-copy-all" style="margin-left:auto">&#128203; Копировать все</button>';
  bar.innerHTML = html;

  bar.querySelectorAll('.src-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var sid = parseInt(chip.dataset.sid);
      selSrcId = selSrcId === sid ? null : sid;
      var sel = document.getElementById('fg-source');
      if (sel && selSrcId) sel.value = selSrcId;
      renderSourcesBar();
      renderCampaigns();
    });
  });
  document.getElementById('sb-add-src').onclick = openNewSource;
  if (selSrcId) {
    var copyBtn = document.getElementById('sb-copy-all');
    if (copyBtn) { var _sid = selSrcId; copyBtn.onclick = function(){ copyAllSource(_sid); }; }
  }
}

function renderCampaigns() {
  var area = document.getElementById('campaigns-area');
  if (!area) return;
  if (!sources.length) {
    area.innerHTML = '<div style="text-align:center;color:#334155;padding:32px;font-size:14px">Создай источник чтобы добавлять кампании</div>';
    return;
  }
  var shownSources = selSrcId ? sources.filter(function(s){ return s.id === selSrcId; }) : sources;
  var html = '';
  shownSources.forEach(function(src) {
    var srcCamps = campaigns.filter(function(c){ return c.source_id === src.id; });
    var android = srcCamps.filter(function(c){ return c.platform === 'android'; });
    var ios = srcCamps.filter(function(c){ return c.platform === 'ios'; });
    html += '<div class="table-section">' +
      '<div class="ts-hdr">' +
        '<span class="ts-hdr-name">' + esc(src.name) + '</span>' +
        (src.key_link ? '<span class="ts-hdr-key">' + esc(src.key_link) + '</span>' : '') +
        '<span class="ts-cnt">' + srcCamps.length + '</span>' +
        '<div class="ts-actions">' +
          '<button class="btn btn-icon" data-copy-src="' + src.id + '">&#128203;</button>' +
          '<button class="btn btn-icon" data-edit-src="' + src.id + '">&#9998;</button>' +
          '<button class="btn btn-danger" data-del-src="' + src.id + '">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="campaign-list" id="cl-' + src.id + '">' +
        (!srcCamps.length ? '<div class="empty-source">Нет кампаний</div>' : '') +
        (android.length ? '<div class="platform-group"><div class="platform-label android">&#9654; Android (' + android.length + ')</div>' + android.map(campRowHTML).join('') + '</div>' : '') +
        (ios.length ? '<div class="platform-group"><div class="platform-label ios">&#9654; iOS (' + ios.length + ')</div>' + ios.map(campRowHTML).join('') + '</div>' : '') +
      '</div>' +
    '</div>';
  });
  area.innerHTML = html;

  area.querySelectorAll('[data-copy-src]').forEach(function(btn) {
    btn.onclick = function(){ copyAllSource(parseInt(btn.dataset.copySrc)); };
  });
  area.querySelectorAll('[data-edit-src]').forEach(function(btn) {
    btn.onclick = function(){ openEditSource(parseInt(btn.dataset.editSrc)); };
  });
  area.querySelectorAll('[data-del-src]').forEach(function(btn) {
    btn.onclick = function(){ deleteSource(parseInt(btn.dataset.delSrc)); };
  });
  area.querySelectorAll('[data-copy-camp]').forEach(function(btn) {
    btn.onclick = function(){ copyNeyming(btn.dataset.copyCamp); };
  });
  area.querySelectorAll('[data-del-camp]').forEach(function(btn) {
    btn.onclick = function(){ deleteCampaign(parseInt(btn.dataset.delCamp)); };
  });
}

function campRowHTML(c) {
  return '<div class="camp-row">' +
    '<span class="camp-copy" data-copy-camp="' + esc(c.neyming) + '" title="Копировать">&#8856;</span>' +
    '<span class="camp-neyming" data-copy-camp="' + esc(c.neyming) + '" title="Нажми чтобы скопировать">' + esc(c.neyming) + '</span>' +
    '<span class="camp-del" data-del-camp="' + c.id + '" title="Удалить">&times;</span>' +
  '</div>';
}

loadPlans();
</script>
</body>
</html>`;
}

initDB().then(function() {
  app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
}).catch(function(err) { console.error(err); process.exit(1); });
