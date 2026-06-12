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
      CREATE TABLE IF NOT EXISTS sources (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        key_link TEXT DEFAULT '',
        position INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
        geo VARCHAR(50) NOT NULL,
        creative VARCHAR(255) NOT NULL,
        assistant VARCHAR(100) DEFAULT '',
        platform VARCHAR(10) NOT NULL DEFAULT 'android',
        neyming TEXT NOT NULL,
        plan_date DATE NOT NULL DEFAULT CURRENT_DATE,
        position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('DB initialized');
  } finally {
    client.release();
  }
}

app.get('/api/sources', async (req, res) => {
  const r = await pool.query('SELECT * FROM sources ORDER BY position, id');
  res.json(r.rows);
});
app.post('/api/sources', async (req, res) => {
  const { name, key_link } = req.body;
  const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM sources');
  const r = await pool.query('INSERT INTO sources(name,key_link,position) VALUES($1,$2,$3) RETURNING *',
    [name, key_link||'', pos.rows[0].p]);
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

app.get('/api/campaigns', async (req, res) => {
  const { date } = req.query;
  let q = 'SELECT c.*, s.name as source_name FROM campaigns c LEFT JOIN sources s ON c.source_id=s.id';
  const params = [];
  if (date) { q += ' WHERE c.plan_date=$1'; params.push(date); }
  q += ' ORDER BY c.source_id, c.platform DESC, c.position, c.id';
  const r = await pool.query(q, params);
  res.json(r.rows);
});
app.get('/api/dates', async (req, res) => {
  const r = await pool.query('SELECT DISTINCT plan_date FROM campaigns ORDER BY plan_date DESC');
  res.json(r.rows.map(function(row){ return row.plan_date; }));
});
app.post('/api/campaigns', async (req, res) => {
  const { source_id, geo, creative, assistant, platform, neyming, plan_date } = req.body;
  const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM campaigns WHERE source_id=$1 AND plan_date=$2', [source_id, plan_date]);
  const r = await pool.query(
    'INSERT INTO campaigns(source_id,geo,creative,assistant,platform,neyming,plan_date,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [source_id, geo, creative, assistant||'', platform, neyming, plan_date, pos.rows[0].p]);
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
.hdr{background:#1a1d27;border-bottom:1px solid #2d3248;height:52px;display:flex;align-items:center;padding:0 20px;gap:0;position:sticky;top:0;z-index:100}
.hdr-logo{font-size:15px;font-weight:800;color:#fff;margin-right:24px;white-space:nowrap}

/* TABS */
.tabs{display:flex;height:100%;align-items:flex-end;gap:2px}
.tab{padding:0 18px;height:38px;display:flex;align-items:center;font-size:13px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;user-select:none;white-space:nowrap}
.tab:hover{color:#e2e8f0}
.tab.active{color:#fff;border-bottom-color:#7c3aed}
.hdr-sep{flex:1}
.hdr-info{font-size:11px;color:#334155}

/* PAGES */
.page{display:none;flex:1;flex-direction:column;overflow:hidden;height:calc(100vh - 52px)}
.page.active{display:flex}

/* ===== PAGE 1: PLAN ===== */
.plan-layout{display:flex;flex:1;overflow:hidden}

/* Sources sidebar */
.src-panel{width:220px;min-width:220px;background:#1a1d27;border-right:1px solid #2d3248;display:flex;flex-direction:column;overflow:hidden}
.src-panel-head{padding:12px 12px 6px;display:flex;align-items:center;justify-content:space-between}
.src-panel-title{font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.8px}
.src-list{flex:1;overflow-y:auto;padding:4px 6px}
.src-item{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;cursor:pointer;color:#94a3b8;transition:background .12s;margin-bottom:1px}
.src-item:hover{background:#252836;color:#e2e8f0}
.src-item.sel{background:#252836;color:#fff;font-weight:600}
.src-item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.src-item-cnt{font-size:10px;background:#1e293b;color:#475569;padding:1px 5px;border-radius:4px;flex-shrink:0}
.src-item-del{opacity:0;color:#ef4444;font-size:14px;cursor:pointer;width:14px;text-align:center;flex-shrink:0}
.src-item:hover .src-item-del{opacity:1}
.src-panel-footer{padding:8px 6px;border-top:1px solid #2d3248}

/* Plan main */
.plan-main{flex:1;display:flex;flex-direction:column;overflow:hidden}

/* Add form */
.add-form{background:#141720;border-bottom:1px solid #2d3248;padding:12px 16px;flex-shrink:0}
.add-form-title{font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
.form-row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
.fg{display:flex;flex-direction:column;gap:3px}
.fg label{font-size:10px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.fg input,.fg select{background:#0f1117;border:1px solid #2d3248;border-radius:6px;padding:6px 9px;color:#e2e8f0;font-size:12px;outline:none;font-family:inherit;transition:border-color .15s}
.fg input:focus,.fg select:focus{border-color:#6d28d9}
.fg input::placeholder{color:#2d3248}
.fg-geo{width:75px}
.fg-creative{width:130px}
.fg-assist{width:100px}
.fg-count{width:95px}
.fg-source{width:160px}
.fg-date{width:130px}
.preview-area{margin-top:8px;display:flex;gap:5px;flex-wrap:wrap}
.pchip{font-size:11px;font-family:monospace;padding:3px 8px;border-radius:5px;cursor:pointer;border:1px solid transparent}
.pchip.and{background:#052e16;color:#4ade80;border-color:#14532d}
.pchip.ios{background:#0c1a3d;color:#60a5fa;border-color:#1e3a5f}
.pchip:hover{opacity:.7}

/* Campaigns list in plan view */
.plan-camps{flex:1;overflow:auto;padding:12px 16px}
.plan-src-block{margin-bottom:16px}
.psb-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.psb-name{font-size:13px;font-weight:700;color:#fff}
.psb-key{font-size:10px;color:#334155;font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.psb-cnt{font-size:10px;background:#1e293b;color:#475569;padding:2px 6px;border-radius:4px}
.psb-copy{cursor:pointer;color:#475569;font-size:11px;padding:3px 7px;border-radius:5px;border:1px solid #2d3248;background:transparent;transition:all .15s}
.psb-copy:hover{background:#252836;color:#e2e8f0}
.psb-edit{cursor:pointer;color:#475569;font-size:11px;padding:3px 7px;border-radius:5px;border:1px solid #2d3248;background:transparent}
.psb-edit:hover{background:#252836;color:#e2e8f0}
.plt-group{margin-bottom:4px}
.plt-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;padding:2px 0 2px 2px;color:#475569}
.plt-label.and{color:#34d399}
.plt-label.ios{color:#60a5fa}
.camp-row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:5px;transition:background .1s}
.camp-row:hover{background:#1a1d27}
.camp-neyming{flex:1;font-size:11px;font-family:monospace;color:#94a3b8;cursor:pointer;word-break:break-all}
.camp-neyming:hover{color:#fff}
.camp-del{opacity:0;color:#ef4444;cursor:pointer;font-size:14px;width:18px;text-align:center;flex-shrink:0}
.camp-row:hover .camp-del{opacity:1}
.empty-src{padding:20px;text-align:center;color:#334155;font-size:12px}

/* ===== PAGE 2: TABLE ===== */
.tbl-page{flex:1;display:flex;flex-direction:column;overflow:hidden}
.tbl-toolbar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #2d3248;background:#1a1d27;flex-shrink:0;flex-wrap:wrap}
.tbl-toolbar-title{font-size:14px;font-weight:700;color:#fff}
.date-tabs{display:flex;gap:4px;flex-wrap:wrap;flex:1}
.dtab{padding:4px 12px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid #2d3248;color:#64748b;transition:all .15s;white-space:nowrap}
.dtab:hover{border-color:#6d28d9;color:#a78bfa}
.dtab.active{background:#3b0764;border-color:#7c3aed;color:#e9d5ff;font-weight:600}
.dtab.today{border-color:#6d28d9}
.tbl-wrap{flex:1;overflow:auto}

/* SPREADSHEET TABLE */
.ztbl{border-collapse:collapse;min-width:100%;table-layout:fixed}
.ztbl th{background:#1a1d27;border:1px solid #2d3248;padding:0;position:sticky;top:0;z-index:10;vertical-align:top;min-width:190px;width:200px}
.ztbl th.th-num{width:44px;min-width:44px;text-align:center;font-size:11px;color:#334155;font-weight:400}
.th-inner{padding:8px 10px 7px;position:relative}
.th-src-name{font-size:12px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:16px}
.th-src-key{font-size:10px;color:#334155;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace}
.th-src-cnt{font-size:10px;color:#475569;margin-top:2px}
.ztbl td{border:1px solid #1e293b;padding:0;vertical-align:top;background:#0f1117}
.ztbl td.td-num{background:#141720;text-align:center;font-size:11px;color:#334155;width:44px;min-width:44px}
.cell-inner{padding:4px 6px;min-height:30px}
.ze{display:flex;align-items:flex-start;gap:4px;padding:2px 2px;border-radius:4px}
.ze:hover{background:#1a1d27}
.ze-plt{width:13px;height:13px;border-radius:2px;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.ze-plt.and{background:#052e16;color:#4ade80}
.ze-plt.ios{background:#0c1a3d;color:#60a5fa}
.ze-neyming{font-size:11px;font-family:monospace;color:#94a3b8;flex:1;line-height:1.4;word-break:break-all;cursor:pointer}
.ze-neyming:hover{color:#fff}
.empty-tbl{padding:60px;text-align:center;color:#334155;font-size:13px}
.no-date{padding:60px;text-align:center;color:#334155;font-size:13px}

/* MODAL */
.modal-ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;align-items:center;justify-content:center}
.modal-ov.open{display:flex}
.modal{background:#1a1d27;border:1px solid #2d3248;border-radius:12px;padding:22px;width:380px;max-width:92vw}
.modal h3{font-size:14px;font-weight:700;margin-bottom:14px;color:#fff}
.modal label{font-size:10px;color:#94a3b8;display:block;margin-bottom:3px;margin-top:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.modal input,.modal textarea{width:100%;background:#0f1117;border:1px solid #2d3248;border-radius:6px;padding:7px 10px;color:#e2e8f0;font-size:13px;outline:none;font-family:inherit}
.modal textarea{min-height:60px;resize:vertical;font-family:monospace;font-size:11px}
.modal input:focus,.modal textarea:focus{border-color:#6d28d9}
.modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}

/* BUTTONS */
.btn{padding:6px 12px;border-radius:7px;border:none;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;transition:all .15s}
.btn-primary{background:#6d28d9;color:#fff}
.btn-primary:hover{background:#7c3aed}
.btn-secondary{background:#1e293b;color:#94a3b8;border:1px solid #2d3248}
.btn-secondary:hover{background:#252836;color:#e2e8f0}
.btn-sm{padding:4px 9px;font-size:11px}
.btn-full{width:100%;justify-content:center}
.btn-ghost{background:transparent;color:#64748b;border:1px solid #2d3248;padding:4px 8px;font-size:11px}
.btn-ghost:hover{background:#252836;color:#e2e8f0}
.save-st{font-size:11px;color:#475569;margin-left:auto}

/* TOAST */
.toast{position:fixed;bottom:20px;right:20px;background:#1e293b;border:1px solid #2d3248;color:#e2e8f0;padding:8px 14px;border-radius:8px;font-size:12px;z-index:300;opacity:0;transform:translateY(6px);transition:all .2s;pointer-events:none}
.toast.show{opacity:1;transform:translateY(0)}
.toast.ok{border-color:#16a34a;color:#4ade80}
.toast.err{border-color:#dc2626;color:#f87171}
</style>
</head>
<body>

<div class="hdr">
  <div class="hdr-logo">&#128640; План залива</div>
  <div class="tabs">
    <div class="tab active" data-tab="plan">&#9998; Создание плана</div>
    <div class="tab" data-tab="table">&#128203; Таблица залива</div>
  </div>
  <div class="hdr-sep"></div>
  <span class="save-st" id="save-st"></span>
</div>

<!-- PAGE 1: PLAN -->
<div class="page active" id="page-plan">
  <div class="plan-layout">
    <!-- Sources sidebar -->
    <div class="src-panel">
      <div class="src-panel-head">
        <span class="src-panel-title">Источники</span>
        <button class="btn-ghost btn" id="btn-add-src-sb">+</button>
      </div>
      <div class="src-list" id="src-list"></div>
      <div class="src-panel-footer">
        <button class="btn btn-secondary btn-full btn-sm" id="btn-add-src-footer">+ Добавить источник</button>
      </div>
    </div>

    <!-- Plan main -->
    <div class="plan-main">
      <div class="add-form">
        <div class="add-form-title">Добавить кампании</div>
        <div class="form-row">
          <div class="fg fg-geo"><label>ГЕО</label><input id="fg-geo" placeholder="CA, UK..."></div>
          <div class="fg fg-creative"><label>Крео</label><input id="fg-creative" placeholder="mrbizness..."></div>
          <div class="fg fg-assist"><label>Ник (опц.)</label><input id="fg-assist" placeholder="burmalda"></div>
          <div class="fg fg-count"><label>Кол-во</label><input id="fg-count" placeholder="2 или 2+3IOS"></div>
          <div class="fg fg-source"><label>Источник</label><select id="fg-source"></select></div>
          <div class="fg fg-date"><label>Дата плана</label><input type="date" id="fg-date"></div>
          <div class="fg" style="justify-content:flex-end">
            <button class="btn btn-primary" id="btn-add-camps">Добавить</button>
          </div>
        </div>
        <div class="preview-area" id="preview-area"></div>
      </div>
      <div class="plan-camps" id="plan-camps"></div>
    </div>
  </div>
</div>

<!-- PAGE 2: TABLE -->
<div class="page" id="page-table">
  <div class="tbl-page">
    <div class="tbl-toolbar">
      <span class="tbl-toolbar-title">Таблица залива</span>
      <div class="date-tabs" id="date-tabs"></div>
    </div>
    <div class="tbl-wrap" id="tbl-wrap"></div>
  </div>
</div>

<!-- MODAL SOURCE -->
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
var sources = [], campaigns = [], selSrcId = null, editSrcId = null, activeDateTab = null;
var _tt;

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
function setSt(msg){ var e=document.getElementById('save-st'); if(e) e.textContent=msg; }
function toast(msg,type){
  var e=document.getElementById('toast');
  e.textContent=msg; e.className='toast show'+(type?' '+type:'');
  clearTimeout(_tt); _tt=setTimeout(function(){ e.classList.remove('show'); },2500);
}
async function api(url,method,body){
  method=method||'GET';
  var opts={method:method,headers:{'Content-Type':'application/json'}};
  if(body) opts.body=JSON.stringify(body);
  var r=await fetch(url,opts);
  if(!r.ok) throw new Error(await r.text());
  if(method==='DELETE') return null;
  return r.json();
}

function kievToday(){
  var now=new Date();
  var kyiv=new Date(now.toLocaleString('en-US',{timeZone:'Europe/Kiev'}));
  return kyiv.getFullYear()+'-'+String(kyiv.getMonth()+1).padStart(2,'0')+'-'+String(kyiv.getDate()).padStart(2,'0');
}
function isToday(d){ return d===kievToday(); }
function fmtDate(d){
  if(!d) return '';
  var p=d.slice(0,10).split('-');
  var label=p[2]+'.'+p[1]+'.'+p[0];
  if(isToday(d.slice(0,10))) return label+' — сегодня';
  return label;
}

// TABS
document.querySelectorAll('.tab').forEach(function(tab){
  tab.addEventListener('click',function(){
    document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
    document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('page-'+tab.dataset.tab).classList.add('active');
    if(tab.dataset.tab==='table') loadTablePage();
  });
});

// INIT
document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('fg-date').value = kievToday();

  document.getElementById('btn-add-src-sb').onclick = openNewSource;
  document.getElementById('btn-add-src-footer').onclick = openNewSource;
  document.getElementById('btn-cancel-src').onclick = function(){ closeModal('m-source'); };
  document.getElementById('btn-save-src').onclick = saveSource;
  document.getElementById('btn-add-camps').onclick = addCampaigns;

  ['fg-geo','fg-creative','fg-assist','fg-count'].forEach(function(id){
    var el=document.getElementById(id);
    if(el) el.addEventListener('input',updatePreview);
  });
  document.getElementById('fg-count').addEventListener('keydown',function(e){
    if(e.key==='Enter') addCampaigns();
  });

  document.addEventListener('keydown',function(e){
    if(e.key==='Escape') document.querySelectorAll('.modal-ov.open').forEach(function(m){ m.classList.remove('open'); });
    if(e.key==='Enter' && !e.target.matches('textarea') && !e.target.matches('input[type=date]')){
      var mo=e.target.closest('.modal-ov');
      if(mo){ var b=mo.querySelector('.btn-primary'); if(b) b.click(); }
    }
  });

  loadAll();
});

async function loadAll(){
  sources = await api('/api/sources');
  campaigns = await api('/api/campaigns');
  renderSourcePanel();
  renderPlanCamps();
  updateSourceSelect();
}

// SOURCES
function openNewSource(){
  editSrcId=null;
  document.getElementById('m-src-title').textContent='Новый источник';
  document.getElementById('inp-src-name').value='';
  document.getElementById('inp-src-key').value='';
  openModal('m-source');
  setTimeout(function(){ document.getElementById('inp-src-name').focus(); },50);
}
function openEditSource(id){
  var s=sources.find(function(x){ return x.id===id; });
  if(!s) return;
  editSrcId=id;
  document.getElementById('m-src-title').textContent='Редактировать источник';
  document.getElementById('inp-src-name').value=s.name;
  document.getElementById('inp-src-key').value=s.key_link||'';
  openModal('m-source');
  setTimeout(function(){ document.getElementById('inp-src-name').focus(); },50);
}
async function saveSource(){
  var name=document.getElementById('inp-src-name').value.trim();
  var key_link=document.getElementById('inp-src-key').value.trim();
  if(!name) return;
  if(editSrcId){
    var s=await api('/api/sources/'+editSrcId,'PATCH',{name:name,key_link:key_link});
    var i=sources.findIndex(function(x){ return x.id===editSrcId; });
    if(i!==-1) sources[i]=s;
  } else {
    var s=await api('/api/sources','POST',{name:name,key_link:key_link});
    sources.push(s);
  }
  closeModal('m-source');
  renderSourcePanel();
  updateSourceSelect();
  toast('Сохранено','ok');
}
async function deleteSource(id){
  if(!confirm('Удалить источник?')) return;
  await api('/api/sources/'+id,'DELETE');
  sources=sources.filter(function(s){ return s.id!==id; });
  campaigns=campaigns.filter(function(c){ return c.source_id!==id; });
  if(selSrcId===id) selSrcId=null;
  renderSourcePanel();
  renderPlanCamps();
  updateSourceSelect();
}

function renderSourcePanel(){
  var list=document.getElementById('src-list');
  var html='';
  sources.forEach(function(s){
    var cnt=campaigns.filter(function(c){ return c.source_id===s.id; }).length;
    html+='<div class="src-item'+(selSrcId===s.id?' sel':'')+'" data-sid="'+s.id+'">' +
      '<span class="src-item-name">'+esc(s.name)+'</span>' +
      '<span class="src-item-cnt">'+cnt+'</span>' +
      '<span class="src-item-del" data-del-src="'+s.id+'">&times;</span>' +
    '</div>';
  });
  list.innerHTML=html;
  list.querySelectorAll('.src-item').forEach(function(item){
    item.addEventListener('click',function(e){
      if(e.target.matches('.src-item-del')) return;
      var sid=parseInt(item.dataset.sid);
      selSrcId=(selSrcId===sid?null:sid);
      renderSourcePanel();
      renderPlanCamps();
    });
  });
  list.querySelectorAll('.src-item-del').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation(); deleteSource(parseInt(btn.dataset.delSrc));
    });
  });
}

function updateSourceSelect(){
  var sel=document.getElementById('fg-source');
  sel.innerHTML=sources.map(function(s){ return '<option value="'+s.id+'">'+esc(s.name)+'</option>'; }).join('');
}

// NEYMING
function buildNeyming(geo,creative,assistant,platform){
  var parts=[geo,creative,'m1non'];
  if(assistant) parts.push(assistant);
  if(platform==='ios') parts.push('IOS');
  parts.push('{{random.digits.5}}');
  parts.push('{{date}}');
  return parts.join('x');
}
function parseCount(raw){
  var upper=(raw||'').toUpperCase().replace(/\s/g,'');
  if(!upper) return null;
  if(upper.indexOf('+')!==-1){
    var p=upper.split('+');
    return {android:parseInt(p[0])||0,ios:parseInt(p[1])||0};
  }
  if(upper.slice(-3)==='IOS' && /^\d+IOS$/.test(upper)){
    return {android:0,ios:parseInt(upper)};
  }
  if(/^\d+$/.test(upper)) return {android:parseInt(upper),ios:0};
  return null;
}
function updatePreview(){
  var geo=(document.getElementById('fg-geo')||{}).value||'';
  var creative=(document.getElementById('fg-creative')||{}).value||'';
  var assistant=(document.getElementById('fg-assist')||{}).value||'';
  var raw=(document.getElementById('fg-count')||{}).value||'';
  var area=document.getElementById('preview-area');
  if(!area) return;
  if(!geo||!creative||!raw){area.innerHTML='';return;}
  var counts=parseCount(raw);
  if(!counts){area.innerHTML='';return;}
  var html='';
  for(var i=0;i<counts.android;i++){
    var n=buildNeyming(geo.trim(),creative.trim(),assistant.trim(),'android');
    html+='<span class="pchip and" data-n="'+esc(n)+'">A: '+esc(n)+'</span>';
  }
  for(var i=0;i<counts.ios;i++){
    var n=buildNeyming(geo.trim(),creative.trim(),assistant.trim(),'ios');
    html+='<span class="pchip ios" data-n="'+esc(n)+'">I: '+esc(n)+'</span>';
  }
  area.innerHTML=html;
  area.querySelectorAll('.pchip').forEach(function(chip){
    chip.onclick=function(){ navigator.clipboard.writeText(chip.dataset.n).then(function(){ toast('Скопировано','ok'); }); };
  });
}

async function addCampaigns(){
  var geo=document.getElementById('fg-geo').value.trim();
  var creative=document.getElementById('fg-creative').value.trim();
  var assistant=document.getElementById('fg-assist').value.trim();
  var raw=document.getElementById('fg-count').value.trim();
  var srcEl=document.getElementById('fg-source');
  var srcId=srcEl?parseInt(srcEl.value):null;
  var plan_date=document.getElementById('fg-date').value||kievToday();
  if(!geo||!creative||!raw){toast('Заполни ГЕО, крео и количество','err');return;}
  if(!srcId){toast('Создай источник сначала','err');return;}
  var counts=parseCount(raw);
  if(!counts||(counts.android===0&&counts.ios===0)){toast('Неверный формат: 2, 2+3IOS или 3IOS','err');return;}
  var toAdd=[];
  for(var i=0;i<counts.android;i++){
    var n=buildNeyming(geo,creative,assistant,'android');
    if(campaigns.some(function(c){ return c.neyming===n&&c.plan_date&&c.plan_date.slice(0,10)===plan_date; })){toast('Дубликат: '+n,'err');continue;}
    toAdd.push({geo:geo,creative:creative,assistant:assistant,platform:'android',neyming:n});
  }
  for(var i=0;i<counts.ios;i++){
    var n=buildNeyming(geo,creative,assistant,'ios');
    if(campaigns.some(function(c){ return c.neyming===n&&c.plan_date&&c.plan_date.slice(0,10)===plan_date; })){toast('Дубликат: '+n,'err');continue;}
    toAdd.push({geo:geo,creative:creative,assistant:assistant,platform:'ios',neyming:n});
  }
  if(!toAdd.length) return;
  setSt('Сохранение...');
  for(var j=0;j<toAdd.length;j++){
    var saved=await api('/api/campaigns','POST',Object.assign({source_id:srcId,plan_date:plan_date},toAdd[j]));
    saved.source_name=(sources.find(function(s){ return s.id===srcId; })||{}).name||'';
    campaigns.push(saved);
  }
  setSt('Сохранено ✓'); setTimeout(function(){ setSt(''); },2000);
  document.getElementById('fg-count').value='';
  document.getElementById('preview-area').innerHTML='';
  renderSourcePanel();
  renderPlanCamps();
  toast('Добавлено '+toAdd.length+' кампаний','ok');
}

async function deleteCampaign(id){
  await api('/api/campaigns/'+id,'DELETE');
  campaigns=campaigns.filter(function(c){ return c.id!==id; });
  renderSourcePanel();
  renderPlanCamps();
}

function renderPlanCamps(){
  var area=document.getElementById('plan-camps');
  if(!area) return;
  var shownSources=selSrcId?sources.filter(function(s){ return s.id===selSrcId; }):sources;
  if(!sources.length){
    area.innerHTML='<div class="empty-src">Создай источник чтобы начать</div>';
    return;
  }
  var html='';
  shownSources.forEach(function(src){
    var srcCamps=campaigns.filter(function(c){ return c.source_id===src.id; });
    var android=srcCamps.filter(function(c){ return c.platform==='android'; });
    var ios=srcCamps.filter(function(c){ return c.platform==='ios'; });
    html+='<div class="plan-src-block">';
    html+='<div class="psb-head">';
    html+='<span class="psb-name">'+esc(src.name)+'</span>';
    if(src.key_link) html+='<span class="psb-key">'+esc(src.key_link)+'</span>';
    html+='<span class="psb-cnt">'+srcCamps.length+'</span>';
    html+='<button class="psb-copy" data-copy-src="'+src.id+'">&#128203; Копировать все</button>';
    html+='<button class="psb-edit" data-edit-src="'+src.id+'">&#9998;</button>';
    html+='</div>';
    if(!srcCamps.length) html+='<div style="padding:6px 0;color:#334155;font-size:12px">Нет кампаний</div>';
    if(android.length){
      html+='<div class="plt-group"><div class="plt-label and">Android ('+android.length+')</div>';
      android.forEach(function(c){ html+=campRowHTML(c); });
      html+='</div>';
    }
    if(ios.length){
      html+='<div class="plt-group"><div class="plt-label ios">iOS ('+ios.length+')</div>';
      ios.forEach(function(c){ html+=campRowHTML(c); });
      html+='</div>';
    }
    html+='</div>';
  });
  area.innerHTML=html;
  area.querySelectorAll('[data-copy-src]').forEach(function(btn){
    btn.onclick=function(){
      var sid=parseInt(btn.dataset.copySrc);
      var list=campaigns.filter(function(c){ return c.source_id===sid; }).map(function(c){ return c.neyming; });
      navigator.clipboard.writeText(list.join('\n')).then(function(){ toast('Скопировано '+list.length,'ok'); });
    };
  });
  area.querySelectorAll('[data-edit-src]').forEach(function(btn){
    btn.onclick=function(){ openEditSource(parseInt(btn.dataset.editSrc)); };
  });
  area.querySelectorAll('[data-copy-camp]').forEach(function(el){
    el.onclick=function(){ navigator.clipboard.writeText(el.dataset.copyCamp).then(function(){ toast('Скопировано','ok'); }); };
  });
  area.querySelectorAll('[data-del-camp]').forEach(function(btn){
    btn.onclick=function(){ deleteCampaign(parseInt(btn.dataset.delCamp)); };
  });
}

function campRowHTML(c){
  return '<div class="camp-row">' +
    '<span class="camp-neyming" data-copy-camp="'+esc(c.neyming)+'">'+esc(c.neyming)+'</span>' +
    '<span style="font-size:10px;color:#334155;flex-shrink:0;white-space:nowrap">'+fmtDate(c.plan_date)+'</span>' +
    '<span class="camp-del" data-del-camp="'+c.id+'">&times;</span>' +
  '</div>';
}

// TABLE PAGE
async function loadTablePage(){
  var dates=await api('/api/dates');
  var today=kievToday();
  if(!activeDateTab){
    activeDateTab=dates.find(function(d){ return d&&d.slice(0,10)===today; });
    if(!activeDateTab && dates.length) activeDateTab=dates[0].slice(0,10);
  }
  renderDateTabs(dates);
  if(activeDateTab) loadTableForDate(activeDateTab);
  else document.getElementById('tbl-wrap').innerHTML='<div class="no-date">Нет данных</div>';
}

function renderDateTabs(dates){
  var el=document.getElementById('date-tabs');
  var today=kievToday();
  var html='';
  dates.forEach(function(d){
    var ds=d&&d.slice(0,10);
    var todayCls=isToday(ds)?' today':'';
    var activeCls=activeDateTab===ds?' active':'';
    html+='<div class="dtab'+todayCls+activeCls+'" data-d="'+ds+'">'+fmtDate(ds)+'</div>';
  });
  el.innerHTML=html;
  el.querySelectorAll('.dtab').forEach(function(tab){
    tab.onclick=function(){
      activeDateTab=tab.dataset.d;
      renderDateTabs(dates);
      loadTableForDate(activeDateTab);
    };
  });
}

async function loadTableForDate(date){
  var wrap=document.getElementById('tbl-wrap');
  wrap.innerHTML='<div style="padding:40px;text-align:center;color:#475569">Загрузка...</div>';
  var dateCamps=await api('/api/campaigns?date='+date);
  if(!dateCamps.length){
    wrap.innerHTML='<div class="empty-tbl">Нет кампаний за эту дату</div>';
    return;
  }
  // collect sources that have campaigns on this date
  var srcIds=[];
  dateCamps.forEach(function(c){
    if(c.source_id && srcIds.indexOf(c.source_id)===-1) srcIds.push(c.source_id);
  });
  var shownSources=sources.filter(function(s){ return srcIds.indexOf(s.id)!==-1; });

  var srcCamps={};
  shownSources.forEach(function(s){
    var and=dateCamps.filter(function(c){ return c.source_id===s.id&&c.platform==='android'; });
    var ios=dateCamps.filter(function(c){ return c.source_id===s.id&&c.platform==='ios'; });
    srcCamps[s.id]={android:and,ios:ios,all:and.concat(ios)};
  });

  var maxRows=0;
  shownSources.forEach(function(s){
    if(srcCamps[s.id].all.length>maxRows) maxRows=srcCamps[s.id].all.length;
  });

  var html='<table class="ztbl"><thead><tr><th class="th-num"></th>';
  shownSources.forEach(function(s){
    var cnt=srcCamps[s.id].all.length;
    html+='<th><div class="th-inner"><div class="th-src-name">'+esc(s.name)+'</div>'+(s.key_link?'<div class="th-src-key">'+esc(s.key_link)+'</div>':'')+'<div class="th-src-cnt">'+cnt+' кампаний</div></div></th>';
  });
  html+='</tr></thead><tbody>';

  for(var i=0;i<maxRows;i++){
    html+='<tr><td class="td-num">'+(i+1)+'</td>';
    shownSources.forEach(function(s){
      var c=srcCamps[s.id].all[i];
      html+='<td><div class="cell-inner">';
      if(c){
        html+='<div class="ze"><div class="ze-plt '+(c.platform==='ios'?'ios':'and')+'">'+(c.platform==='ios'?'I':'A')+'</div><div class="ze-neyming" data-copy="'+esc(c.neyming)+'">'+esc(c.neyming)+'</div></div>';
      }
      html+='</div></td>';
    });
    html+='</tr>';
  }
  html+='</tbody></table>';
  wrap.innerHTML=html;
  wrap.querySelectorAll('[data-copy]').forEach(function(el){
    el.onclick=function(){ navigator.clipboard.writeText(el.dataset.copy).then(function(){ toast('Скопировано','ok'); }); };
  });
}
</script>
</body>
</html>`;

initDB().then(function() {
  app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
}).catch(function(err) { console.error(err); process.exit(1); });
