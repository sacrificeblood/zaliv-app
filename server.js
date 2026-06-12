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

// PLANS
app.get('/api/plans', async (req, res) => {
  const r = await pool.query('SELECT * FROM plans ORDER BY created_at DESC');
  res.json(r.rows);
});
app.post('/api/plans', async (req, res) => {
  const { name } = req.body;
  const r = await pool.query('INSERT INTO plans(name) VALUES($1) RETURNING *', [name]);
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

// SOURCES
app.get('/api/plans/:id/sources', async (req, res) => {
  const r = await pool.query('SELECT * FROM sources WHERE plan_id=$1 ORDER BY position,id', [req.params.id]);
  res.json(r.rows);
});
app.post('/api/plans/:id/sources', async (req, res) => {
  const { name, key_link } = req.body;
  const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM sources WHERE plan_id=$1', [req.params.id]);
  const r = await pool.query(
    'INSERT INTO sources(plan_id,name,key_link,position) VALUES($1,$2,$3,$4) RETURNING *',
    [req.params.id, name, key_link||'', pos.rows[0].p]
  );
  res.json(r.rows[0]);
});
app.patch('/api/sources/:id', async (req, res) => {
  const { name, key_link } = req.body;
  const r = await pool.query('UPDATE sources SET name=$1,key_link=$2 WHERE id=$3 RETURNING *', [name, key_link||'', req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/sources/:id', async (req, res) => {
  await pool.query('DELETE FROM sources WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// CAMPAIGNS
app.get('/api/plans/:id/campaigns', async (req, res) => {
  const r = await pool.query(
    'SELECT c.*, s.name as source_name FROM campaigns c LEFT JOIN sources s ON c.source_id=s.id WHERE c.plan_id=$1 ORDER BY c.source_id, c.platform DESC, c.position, c.id',
    [req.params.id]
  );
  res.json(r.rows);
});
app.post('/api/campaigns', async (req, res) => {
  const { plan_id, source_id, geo, creative, assistant, platform, neyming } = req.body;
  const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM campaigns WHERE plan_id=$1 AND source_id=$2', [plan_id, source_id]);
  const r = await pool.query(
    'INSERT INTO campaigns(plan_id,source_id,geo,creative,assistant,platform,neyming,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [plan_id, source_id, geo, creative, assistant||'', platform, neyming, pos.rows[0].p]
  );
  res.json(r.rows[0]);
});
app.delete('/api/campaigns/:id', async (req, res) => {
  await pool.query('DELETE FROM campaigns WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});
app.patch('/api/campaigns/:id', async (req, res) => {
  const { neyming, source_id } = req.body;
  const r = await pool.query('UPDATE campaigns SET neyming=$1, source_id=$2 WHERE id=$3 RETURNING *', [neyming, source_id, req.params.id]);
  res.json(r.rows[0]);
});

// Serve frontend
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML);
});

const HTML = `<!DOCTYPE html>
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

/* HEADER */
.hdr{background:#1a1d27;border-bottom:1px solid #2d3248;height:52px;display:flex;align-items:center;padding:0 20px;gap:12px;position:sticky;top:0;z-index:100}
.hdr h1{font-size:17px;font-weight:700;color:#fff}
.hdr-sep{flex:1}
.save-st{font-size:12px;color:#475569}

/* LAYOUT */
.layout{display:flex;height:calc(100vh - 52px)}

/* SIDEBAR */
.sidebar{width:220px;min-width:220px;background:#1a1d27;border-right:1px solid #2d3248;display:flex;flex-direction:column}
.sb-title{padding:14px 14px 6px;font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.8px}
.sb-list{flex:1;overflow-y:auto;padding:4px 6px}
.plan-item{display:flex;align-items:center;gap:6px;padding:7px 9px;border-radius:7px;cursor:pointer;font-size:13px;color:#94a3b8;transition:background .12s}
.plan-item:hover{background:#252836;color:#e2e8f0}
.plan-item.active{background:#252836;color:#fff;font-weight:600}
.plan-item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plan-item-del{opacity:0;color:#ef4444;font-size:16px;cursor:pointer;width:18px;text-align:center;flex-shrink:0}
.plan-item:hover .plan-item-del{opacity:1}
.sb-footer{padding:10px 6px;border-top:1px solid #2d3248}

/* MAIN */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}

/* TOOLBAR */
.toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #2d3248;background:#1a1d27;flex-shrink:0;flex-wrap:wrap}
.plan-title{font-size:15px;font-weight:700;color:#fff;cursor:pointer;flex:1;min-width:100px}
.plan-title:hover{color:#a78bfa}

/* CONTENT AREA */
.content{flex:1;overflow:auto;padding:16px}

/* ADD CAMPAIGN FORM */
.add-form{background:#1a1d27;border:1px solid #2d3248;border-radius:10px;padding:16px;margin-bottom:16px}
.add-form h3{font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px}
.form-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.form-group{display:flex;flex-direction:column;gap:4px}
.form-group label{font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.form-group input,
.form-group select{background:#0f1117;border:1px solid #2d3248;border-radius:7px;padding:7px 10px;color:#e2e8f0;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s;min-width:0}
.form-group input:focus,
.form-group select:focus{border-color:#6d28d9}
.form-group input::placeholder{color:#334155}
.fg-geo{width:90px}
.fg-creative{flex:1;min-width:130px}
.fg-assist{width:110px}
.fg-count{width:70px}
.fg-source{flex:1;min-width:140px}

.parse-preview{margin-top:12px;padding:10px 12px;background:#0f1117;border-radius:7px;border:1px solid #1e293b;font-size:12px;font-family:monospace;color:#64748b;line-height:1.6;display:none}
.parse-preview.show{display:block}
.preview-android{color:#34d399}
.preview-ios{color:#60a5fa}
.preview-label{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;font-family:sans-serif}

/* TABLE */
.table-section{background:#1a1d27;border:1px solid #2d3248;border-radius:10px;overflow:hidden;margin-bottom:12px}
.table-section-hdr{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#141720;border-bottom:1px solid #2d3248;cursor:pointer;user-select:none}
.ts-hdr-name{font-size:13px;font-weight:700;color:#fff;flex:1}
.ts-hdr-key{font-size:11px;color:#475569;font-family:monospace;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ts-hdr-count{font-size:11px;background:#252836;color:#94a3b8;padding:2px 7px;border-radius:10px}
.ts-hdr-actions{display:flex;gap:6px;opacity:0;transition:opacity .15s}
.table-section-hdr:hover .ts-hdr-actions{opacity:1}

.campaign-list{padding:6px}
.platform-group{margin-bottom:4px}
.platform-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;padding:4px 8px;color:#475569}
.platform-label.android{color:#34d399}
.platform-label.ios{color:#60a5fa}

.camp-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;transition:background .1s;group:true}
.camp-row:hover{background:#252836}
.camp-neyming{flex:1;font-size:12px;font-family:monospace;color:#cbd5e1;word-break:break-all;cursor:pointer}
.camp-neyming:hover{color:#fff}
.camp-del{opacity:0;color:#ef4444;cursor:pointer;font-size:16px;width:20px;text-align:center;flex-shrink:0;transition:opacity .15s}
.camp-row:hover .camp-del{opacity:1}
.camp-copy{opacity:0;color:#6d28d9;cursor:pointer;font-size:13px;width:20px;text-align:center;flex-shrink:0;transition:opacity .15s}
.camp-row:hover .camp-copy{opacity:1}

.empty-source{padding:16px;text-align:center;color:#334155;font-size:13px}

/* EMPTY STATE */
.empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#334155;gap:10px}
.empty-state .ico{font-size:44px}
.empty-state h2{font-size:17px;color:#475569;font-weight:600}

/* BUTTONS */
.btn{padding:7px 13px;border-radius:7px;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.btn-primary{background:#6d28d9;color:#fff}
.btn-primary:hover{background:#7c3aed}
.btn-secondary{background:#1e293b;color:#94a3b8;border:1px solid #2d3248}
.btn-secondary:hover{background:#252836;color:#e2e8f0}
.btn-sm{padding:5px 9px;font-size:12px}
.btn-full{width:100%;justify-content:center}
.btn-danger{background:#450a0a;color:#f87171;border:1px solid #7f1d1d}
.btn-danger:hover{background:#7f1d1d}
.btn-icon{padding:5px 7px;background:transparent;border:1px solid #2d3248;color:#64748b}
.btn-icon:hover{background:#252836;color:#e2e8f0}

/* MODAL */
.modal-ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;align-items:center;justify-content:center}
.modal-ov.open{display:flex}
.modal{background:#1a1d27;border:1px solid #2d3248;border-radius:12px;padding:22px;width:400px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.modal h3{font-size:15px;font-weight:700;margin-bottom:14px;color:#fff}
.modal label{font-size:11px;color:#94a3b8;display:block;margin-bottom:4px;margin-top:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.modal input,.modal textarea{width:100%;background:#0f1117;border:1px solid #2d3248;border-radius:7px;padding:8px 11px;color:#e2e8f0;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s}
.modal textarea{min-height:70px;resize:vertical;font-family:monospace;font-size:12px}
.modal input:focus,.modal textarea:focus{border-color:#6d28d9}
.modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}

/* TOAST */
.toast{position:fixed;bottom:20px;right:20px;background:#1e293b;border:1px solid #2d3248;color:#e2e8f0;padding:9px 14px;border-radius:8px;font-size:13px;z-index:300;opacity:0;transform:translateY(6px);transition:all .2s;pointer-events:none}
.toast.show{opacity:1;transform:translateY(0)}
.toast.ok{border-color:#16a34a;color:#4ade80}
.toast.err{border-color:#dc2626;color:#f87171}

/* SOURCES PANEL */
.sources-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #2d3248;background:#141720}
.source-chip{padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;border:1px solid #2d3248;color:#64748b;transition:all .15s;display:flex;align-items:center;gap:5px}
.source-chip:hover{border-color:#6d28d9;color:#a78bfa}
.source-chip.sel{background:#3b0764;border-color:#7c3aed;color:#e9d5ff;font-weight:600}
.source-chip-del{opacity:0;font-size:14px;color:#ef4444;margin-left:2px}
.source-chip:hover .source-chip-del{opacity:1}

/* COPY ALL BTN */
.copy-all-btn{margin-left:auto;flex-shrink:0}
</style>
</head>
<body>
<div class="hdr">
  <h1>🚀 План залива</h1>
  <div class="hdr-sep"></div>
  <span class="save-st" id="save-st"></span>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="sb-title">Планы</div>
    <div class="sb-list" id="plan-list"></div>
    <div class="sb-footer">
      <button class="btn btn-primary btn-full btn-sm" onclick="openModal('m-new-plan');setTimeout(()=>document.getElementById('inp-plan-name').focus(),50)">+ Новый план</button>
    </div>
  </div>

  <div class="main" id="main"></div>
</div>

<!-- MODALS -->
<div class="modal-ov" id="m-new-plan">
  <div class="modal">
    <h3>Новый план</h3>
    <label>Название</label>
    <input id="inp-plan-name" placeholder="например: 12 июня">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal('m-new-plan')">Отмена</button>
      <button class="btn btn-primary" onclick="createPlan()">Создать</button>
    </div>
  </div>
</div>

<div class="modal-ov" id="m-source">
  <div class="modal">
    <h3 id="m-source-title">Новый источник</h3>
    <label>Название источника</label>
    <input id="inp-src-name" placeholder="OUR APPS CHICKEN">
    <label>Ключ / ссылка (необязательно)</label>
    <textarea id="inp-src-key" placeholder="bndrnt000612&key=..."></textarea>
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal('m-source')">Отмена</button>
      <button class="btn btn-primary" onclick="saveSource()">Сохранить</button>
    </div>
  </div>
</div>

<div class="modal-ov" id="m-rename-plan">
  <div class="modal">
    <h3>Переименовать план</h3>
    <label>Название</label>
    <input id="inp-rename-plan">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal('m-rename-plan')">Отмена</button>
      <button class="btn btn-primary" onclick="renamePlan()">Сохранить</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
// ---- STATE ----
let plans=[], curPlanId=null, sources=[], campaigns=[], editSrcId=null, selSrcId=null;

// ---- INIT ----
document.addEventListener('DOMContentLoaded',()=>{
  loadPlans();
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape') document.querySelectorAll('.modal-ov.open').forEach(m=>m.classList.remove('open'));
    if(e.key==='Enter'){
      const mo=e.target.closest('.modal-ov');
      if(mo && !e.target.matches('textarea')){mo.querySelector('.btn-primary')?.click();}
    }
  });
});

// ---- PLANS ----
async function loadPlans(){
  plans=await api('/api/plans');
  renderSidebar();
  if(plans.length && !curPlanId) selectPlan(plans[0].id);
}
function renderSidebar(){
  const el=document.getElementById('plan-list');
  el.innerHTML=plans.map(p=>\`
    <div class="plan-item\${p.id===curPlanId?' active':''}" onclick="selectPlan(\${p.id})">
      <span class="plan-item-name">\${esc(p.name)}</span>
      <span class="plan-item-del" onclick="deletePlan(event,\${p.id})">×</span>
    </div>\`).join('');
}
async function createPlan(){
  const name=document.getElementById('inp-plan-name').value.trim();
  if(!name)return;
  const p=await api('/api/plans','POST',{name});
  plans.unshift(p);
  closeModal('m-new-plan');
  renderSidebar();
  selectPlan(p.id);
  toast('План создан','ok');
}
async function deletePlan(e,id){
  e.stopPropagation();
  if(!confirm('Удалить план?'))return;
  await api('/api/plans/'+id,'DELETE');
  plans=plans.filter(p=>p.id!==id);
  if(curPlanId===id){curPlanId=null;sources=[];campaigns=[];renderMain();}
  renderSidebar();
}
function openRename(){
  const p=plans.find(x=>x.id===curPlanId);
  document.getElementById('inp-rename-plan').value=p?.name||'';
  openModal('m-rename-plan');
  setTimeout(()=>document.getElementById('inp-rename-plan').focus(),50);
}
async function renamePlan(){
  const name=document.getElementById('inp-rename-plan').value.trim();
  if(!name)return;
  const p=await api('/api/plans/'+curPlanId,'PATCH',{name});
  const i=plans.findIndex(x=>x.id===curPlanId);
  if(i!==-1)plans[i]=p;
  closeModal('m-rename-plan');
  renderSidebar();
  document.getElementById('plan-title-el')&&(document.getElementById('plan-title-el').textContent=name);
}
async function selectPlan(id){
  curPlanId=id; selSrcId=null;
  renderSidebar();
  showLoading();
  [sources,campaigns]=await Promise.all([
    api('/api/plans/'+id+'/sources'),
    api('/api/plans/'+id+'/campaigns')
  ]);
  renderMain();
}

// ---- SOURCES ----
function openNewSource(){
  editSrcId=null;
  document.getElementById('m-source-title').textContent='Новый источник';
  document.getElementById('inp-src-name').value='';
  document.getElementById('inp-src-key').value='';
  openModal('m-source');
  setTimeout(()=>document.getElementById('inp-src-name').focus(),50);
}
function openEditSource(id){
  const s=sources.find(x=>x.id===id);
  if(!s)return;
  editSrcId=id;
  document.getElementById('m-source-title').textContent='Редактировать источник';
  document.getElementById('inp-src-name').value=s.name;
  document.getElementById('inp-src-key').value=s.key_link||'';
  openModal('m-source');
  setTimeout(()=>document.getElementById('inp-src-name').focus(),50);
}
async function saveSource(){
  const name=document.getElementById('inp-src-name').value.trim();
  const key_link=document.getElementById('inp-src-key').value.trim();
  if(!name)return;
  if(editSrcId){
    const s=await api('/api/sources/'+editSrcId,'PATCH',{name,key_link});
    const i=sources.findIndex(x=>x.id===editSrcId);
    if(i!==-1)sources[i]=s;
  } else {
    const s=await api('/api/plans/'+curPlanId+'/sources','POST',{name,key_link});
    sources.push(s);
  }
  closeModal('m-source');
  renderMain();
  toast('Сохранено','ok');
}
async function deleteSource(id){
  if(!confirm('Удалить источник?'))return;
  await api('/api/sources/'+id,'DELETE');
  sources=sources.filter(s=>s.id!==id);
  campaigns=campaigns.filter(c=>c.source_id!==id);
  if(selSrcId===id)selSrcId=null;
  renderMain();
}

// ---- NEYMING GENERATION ----
function buildNeyming(geo, creative, assistant, platform){
  const parts=[geo, creative, 'm1non'];
  if(assistant) parts.push(assistant);
  if(platform==='ios') parts.push('IOS');
  parts.push('{{random.digits.5}}');
  parts.push('{{date}}');
  return parts.join('x');
}

function parseInput(){
  const geo=document.getElementById('fg-geo').value.trim();
  const creative=document.getElementById('fg-creative').value.trim();
  const assistant=document.getElementById('fg-assist').value.trim();
  const raw=document.getElementById('fg-count').value.trim();
  
  if(!geo||!creative||!raw) return null;
  
  // Parse: "2" = 2 android, "2 + 2 IOS" or "2+2IOS" 
  const match = raw.match(/^(\d+)(?:\s*\+\s*(\d+)\s*(?:IOS|iOS|ios)?)?$/i);
  const iosOnly = raw.match(/^(\d+)\s*(?:IOS|iOS|ios)$/i);
  
  let androidCount=0, iosCount=0;
  
  if(iosOnly){
    iosCount=parseInt(iosOnly[1]);
  } else if(match){
    androidCount=parseInt(match[1]||0);
    iosCount=parseInt(match[2]||0);
  }
  
  const androidNeymings=[];
  const iosNeymings=[];
  
  for(let i=0;i<androidCount;i++){
    androidNeymings.push(buildNeyming(geo,creative,assistant,'android'));
  }
  for(let i=0;i<iosCount;i++){
    iosNeymings.push(buildNeyming(geo,creative,assistant,'ios'));
  }
  
  return {geo, creative, assistant, androidNeymings, iosNeymings};
}

function updatePreview(){
  const result=parseInput();
  const el=document.getElementById('preview');
  if(!el)return;
  if(!result){el.className='parse-preview';return;}
  
  const {androidNeymings, iosNeymings}=result;
  let html='';
  
  if(androidNeymings.length){
    html+=\`<div class="preview-label">Android (\${androidNeymings.length})</div>\`;
    html+=androidNeymings.map(n=>\`<div class="preview-android">\${esc(n)}</div>\`).join('');
  }
  if(iosNeymings.length){
    if(html) html+='<div style="height:6px"></div>';
    html+=\`<div class="preview-label">iOS (\${iosNeymings.length})</div>\`;
    html+=iosNeymings.map(n=>\`<div class="preview-ios">\${esc(n)}</div>\`).join('');
  }
  
  el.innerHTML=html;
  el.className='parse-preview show';
}

async function addCampaigns(){
  const result=parseInput();
  if(!result){toast('Заполни ГЕО, крео и количество','err');return;}
  
  const srcId = selSrcId || (sources.length ? sources[0].id : null);
  if(!srcId){toast('Создай источник сначала','err');return;}
  
  const {geo,creative,assistant,androidNeymings,iosNeymings}=result;
  const toAdd=[];
  
  for(const n of androidNeymings){
    // check duplicate
    if(campaigns.some(c=>c.neyming===n)){toast('Дубликат: '+n,'err');continue;}
    toAdd.push({geo,creative,assistant,platform:'android',neyming:n});
  }
  for(const n of iosNeymings){
    if(campaigns.some(c=>c.neyming===n)){toast('Дубликат: '+n,'err');continue;}
    toAdd.push({geo,creative,assistant,platform:'ios',neyming:n});
  }
  
  setSt('Сохранение...');
  for(const c of toAdd){
    const saved=await api('/api/campaigns','POST',{plan_id:curPlanId,source_id:srcId,...c});
    saved.source_name=sources.find(s=>s.id===srcId)?.name||'';
    campaigns.push(saved);
  }
  setSt('Сохранено ✓');
  setTimeout(()=>setSt(''),2000);
  
  // clear count field, keep geo+creative for convenience
  document.getElementById('fg-count').value='';
  document.getElementById('preview').className='parse-preview';
  
  renderCampaigns();
  toast(\`Добавлено \${toAdd.length} кампаний\`,'ok');
}

async function deleteCampaign(id){
  await api('/api/campaigns/'+id,'DELETE');
  campaigns=campaigns.filter(c=>c.id!==id);
  renderCampaigns();
}

function copyNeyming(text){
  navigator.clipboard.writeText(text).then(()=>toast('Скопировано','ok'));
}

function copyAllSource(srcId){
  const list=campaigns.filter(c=>c.source_id===srcId).map(c=>c.neyming);
  navigator.clipboard.writeText(list.join('\\n')).then(()=>toast(\`Скопировано \${list.length} неймингов\`,'ok'));
}

// ---- RENDER ----
function showLoading(){
  document.getElementById('main').innerHTML='<div class="empty-state"><div class="spinner" style="width:24px;height:24px;border:2px solid #2d3248;border-top-color:#6d28d9;border-radius:50%;animation:spin .6s linear infinite;margin:auto;margin-top:40vh"></div></div>';
}

function renderMain(){
  if(!curPlanId){
    document.getElementById('main').innerHTML='<div class="empty-state"><div class="ico">📋</div><h2>Выбери или создай план</h2></div>';
    return;
  }
  const plan=plans.find(p=>p.id===curPlanId);
  
  document.getElementById('main').innerHTML=\`
    <div class="toolbar">
      <span class="plan-title" id="plan-title-el" onclick="openRename()">\${esc(plan?.name||'')}</span>
      <button class="btn btn-secondary btn-sm" onclick="openNewSource()">+ Источник</button>
    </div>
    <div class="sources-bar" id="sources-bar"></div>
    <div class="content">
      <div class="add-form">
        <h3>✦ Добавить кампании</h3>
        <div class="form-row">
          <div class="form-group fg-geo">
            <label>ГЕО</label>
            <input id="fg-geo" placeholder="CA, ROEU..." oninput="updatePreview()">
          </div>
          <div class="form-group fg-creative">
            <label>Крео</label>
            <input id="fg-creative" placeholder="mrbizness, nalog..." oninput="updatePreview()">
          </div>
          <div class="form-group fg-assist">
            <label>Ник (опцион.)</label>
            <input id="fg-assist" placeholder="burmalda" oninput="updatePreview()">
          </div>
          <div class="form-group fg-count">
            <label>Кол-во</label>
            <input id="fg-count" placeholder="2 или 2+2IOS" oninput="updatePreview()" onkeydown="if(event.key==='Enter')addCampaigns()">
          </div>
          <div class="form-group fg-source">
            <label>Источник</label>
            <select id="fg-source">\${sources.map(s=>\`<option value="\${s.id}">\${esc(s.name)}</option>\`).join('')}</select>
          </div>
          <div class="form-group" style="justify-content:flex-end">
            <button class="btn btn-primary" onclick="addCampaigns()">Добавить</button>
          </div>
        </div>
        <div class="parse-preview" id="preview"></div>
      </div>
      <div id="campaigns-area"></div>
    </div>\`;
  
  renderSourcesBar();
  renderCampaigns();
}

function renderSourcesBar(){
  const bar=document.getElementById('sources-bar');
  if(!bar)return;
  bar.innerHTML=\`
    <span style="font-size:11px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0">Источники:</span>
    \${sources.map(s=>\`
      <div class="source-chip\${selSrcId===s.id?' sel':''}" onclick="selSrcId=\${s.id};renderSourcesBar();renderCampaigns()">
        \${esc(s.name)}
        <span class="source-chip-del" onclick="event.stopPropagation();openEditSource(\${s.id})">✎</span>
        <span class="source-chip-del" onclick="event.stopPropagation();deleteSource(\${s.id})" style="color:#ef4444">×</span>
      </div>\`).join('')}
    <button class="btn btn-icon btn-sm" onclick="openNewSource()" title="Добавить источник">+</button>
    \${selSrcId?'<button class="btn btn-secondary btn-sm copy-all-btn" onclick="copyAllSource('+selSrcId+')">📋 Копировать все</button>':''}
  \`;
  // Sync select
  const sel=document.getElementById('fg-source');
  if(sel && selSrcId) sel.value=selSrcId;
}

function renderCampaigns(){
  const area=document.getElementById('campaigns-area');
  if(!area)return;
  
  const shownSources=selSrcId ? sources.filter(s=>s.id===selSrcId) : sources;
  
  if(!sources.length){
    area.innerHTML='<div style="text-align:center;color:#334155;padding:32px;font-size:14px">Создай источник чтобы добавлять кампании</div>';
    return;
  }
  
  area.innerHTML=shownSources.map(src=>{
    const srcCamps=campaigns.filter(c=>c.source_id===src.id);
    const android=srcCamps.filter(c=>c.platform==='android');
    const ios=srcCamps.filter(c=>c.platform==='ios');
    const total=srcCamps.length;
    
    return \`<div class="table-section">
      <div class="table-section-hdr">
        <span class="ts-hdr-name">\${esc(src.name)}</span>
        \${src.key_link?'<span class="ts-hdr-key">'+esc(src.key_link)+'</span>':''}
        <span class="ts-hdr-count">\${total}</span>
        <div class="ts-hdr-actions">
          <button class="btn btn-icon btn-sm" onclick="event.stopPropagation();copyAllSource(\${src.id})" title="Копировать все">📋</button>
          <button class="btn btn-icon btn-sm" onclick="event.stopPropagation();openEditSource(\${src.id})" title="Редактировать">✎</button>
          <button class="btn btn-icon btn-sm btn-danger" onclick="event.stopPropagation();deleteSource(\${src.id})" title="Удалить">×</button>
        </div>
      </div>
      <div class="campaign-list">
        \${!total?'<div class="empty-source">Нет кампаний</div>':''}
        \${android.length?\`<div class="platform-group">
          <div class="platform-label android">▶ Android (\${android.length})</div>
          \${android.map(c=>campRow(c)).join('')}
        </div>\`:''}
        \${ios.length?\`<div class="platform-group">
          <div class="platform-label ios">▶ iOS (\${ios.length})</div>
          \${ios.map(c=>campRow(c)).join('')}
        </div>\`:''}
      </div>
    </div>\`;
  }).join('');
}

function campRow(c){
  return \`<div class="camp-row">
    <span class="camp-copy" onclick="copyNeyming('\${esc(c.neyming)}')" title="Копировать">⎘</span>
    <span class="camp-neyming" onclick="copyNeyming('\${esc(c.neyming)}')" title="Нажми чтобы скопировать">\${esc(c.neyming)}</span>
    <span class="camp-del" onclick="deleteCampaign(\${c.id})" title="Удалить">×</span>
  </div>\`;
}

// ---- UTILS ----
async function api(url, method='GET', body){
  const opts={method,headers:{'Content-Type':'application/json'}};
  if(body) opts.body=JSON.stringify(body);
  const r=await fetch(url,opts);
  if(!r.ok) throw new Error(await r.text());
  if(method==='DELETE') return null;
  return r.json();
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function setSt(msg){const el=document.getElementById('save-st');if(el)el.textContent=msg;}
let _tt;
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;el.className='toast show'+(type?' '+type:'');
  clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove('show'),2500);
}
</script>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>
</body>
</html>`;

initDB().then(() => {
  app.listen(PORT, () => console.log('Server running on port ' + PORT));
}).catch(err => { console.error(err); process.exit(1); });
