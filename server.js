const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(express.json());

// Init DB tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tables (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS columns (
        id SERIAL PRIMARY KEY,
        table_id INTEGER REFERENCES tables(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        key_link TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS rows (
        id SERIAL PRIMARY KEY,
        table_id INTEGER REFERENCES tables(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS cells (
        id SERIAL PRIMARY KEY,
        row_id INTEGER REFERENCES rows(id) ON DELETE CASCADE,
        column_id INTEGER REFERENCES columns(id) ON DELETE CASCADE,
        value TEXT DEFAULT '',
        UNIQUE(row_id, column_id)
      );
    `);
    console.log('DB initialized');
  } finally {
    client.release();
  }
}

// === TABLES ===

// Get all tables
app.get('/api/tables', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tables ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create table
app.post('/api/tables', async (req, res) => {
  const { name } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO tables (name) VALUES ($1) RETURNING *',
      [name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete table
app.delete('/api/tables/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tables WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rename table
app.patch('/api/tables/:id', async (req, res) => {
  const { name } = req.body;
  try {
    const result = await pool.query(
      'UPDATE tables SET name=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [name, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === FULL TABLE DATA ===

app.get('/api/tables/:id/data', async (req, res) => {
  const tableId = req.params.id;
  try {
    const colsResult = await pool.query(
      'SELECT * FROM columns WHERE table_id=$1 ORDER BY position',
      [tableId]
    );
    const rowsResult = await pool.query(
      'SELECT * FROM rows WHERE table_id=$1 ORDER BY position',
      [tableId]
    );
    const cellsResult = await pool.query(
      `SELECT c.* FROM cells c
       JOIN rows r ON c.row_id = r.id
       WHERE r.table_id = $1`,
      [tableId]
    );

    const cellsMap = {};
    for (const cell of cellsResult.rows) {
      if (!cellsMap[cell.row_id]) cellsMap[cell.row_id] = {};
      cellsMap[cell.row_id][cell.column_id] = cell.value;
    }

    res.json({
      columns: colsResult.rows,
      rows: rowsResult.rows,
      cells: cellsMap,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === COLUMNS ===

app.post('/api/tables/:id/columns', async (req, res) => {
  const { name, key_link } = req.body;
  const tableId = req.params.id;
  try {
    const posResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM columns WHERE table_id=$1',
      [tableId]
    );
    const pos = posResult.rows[0].pos;
    const result = await pool.query(
      'INSERT INTO columns (table_id, position, name, key_link) VALUES ($1,$2,$3,$4) RETURNING *',
      [tableId, pos, name, key_link || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/columns/:id', async (req, res) => {
  const { name, key_link } = req.body;
  try {
    const result = await pool.query(
      'UPDATE columns SET name=$1, key_link=$2 WHERE id=$3 RETURNING *',
      [name, key_link, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/columns/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM columns WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ROWS ===

app.post('/api/tables/:id/rows', async (req, res) => {
  const tableId = req.params.id;
  try {
    const posResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM rows WHERE table_id=$1',
      [tableId]
    );
    const pos = posResult.rows[0].pos;
    const result = await pool.query(
      'INSERT INTO rows (table_id, position) VALUES ($1,$2) RETURNING *',
      [tableId, pos]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rows/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM rows WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === CELLS ===

app.post('/api/cells', async (req, res) => {
  const { row_id, column_id, value } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO cells (row_id, column_id, value)
       VALUES ($1,$2,$3)
       ON CONFLICT (row_id, column_id)
       DO UPDATE SET value=$3
       RETURNING *`,
      [row_id, column_id, value]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
const HTML_PAGE = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>План залива</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f1117;
    color: #e2e8f0;
    min-height: 100vh;
  }

  /* HEADER */
  .header {
    background: #1a1d27;
    border-bottom: 1px solid #2d3248;
    padding: 0 24px;
    height: 56px;
    display: flex;
    align-items: center;
    gap: 16px;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .header h1 {
    font-size: 18px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.3px;
  }
  .header-sep { flex: 1; }

  /* LAYOUT */
  .layout { display: flex; height: calc(100vh - 56px); }

  /* SIDEBAR */
  .sidebar {
    width: 240px;
    min-width: 240px;
    background: #1a1d27;
    border-right: 1px solid #2d3248;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sidebar-title {
    padding: 16px 16px 8px;
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .sidebar-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
  }
  .table-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
    font-size: 14px;
    color: #94a3b8;
  }
  .table-item:hover { background: #252836; color: #e2e8f0; }
  .table-item.active { background: #252836; color: #fff; }
  .table-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .table-item-del {
    opacity: 0;
    cursor: pointer;
    color: #ef4444;
    font-size: 16px;
    width: 20px;
    text-align: center;
    flex-shrink: 0;
  }
  .table-item:hover .table-item-del { opacity: 1; }

  .sidebar-footer {
    padding: 12px 8px;
    border-top: 1px solid #2d3248;
  }

  /* MAIN AREA */
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #0f1117;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 20px;
    border-bottom: 1px solid #2d3248;
    background: #1a1d27;
    flex-shrink: 0;
  }
  .toolbar-title {
    font-size: 16px;
    font-weight: 600;
    color: #fff;
    flex: 1;
    cursor: pointer;
  }
  .toolbar-title:hover { color: #a78bfa; }

  /* EMPTY STATE */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #475569;
    gap: 12px;
  }
  .empty-state .icon { font-size: 48px; }
  .empty-state h2 { font-size: 18px; color: #64748b; font-weight: 600; }
  .empty-state p { font-size: 14px; }

  /* TABLE WRAPPER */
  .table-wrapper {
    flex: 1;
    overflow: auto;
    padding: 20px;
  }

  /* TABLE */
  table {
    border-collapse: collapse;
    min-width: 100%;
    table-layout: fixed;
  }

  .col-num { width: 48px; min-width: 48px; }
  .col-data { min-width: 200px; width: 220px; }

  th {
    background: #1a1d27;
    padding: 0;
    position: sticky;
    top: 0;
    z-index: 10;
    border: 1px solid #2d3248;
    vertical-align: top;
  }

  .th-inner {
    padding: 8px 10px 6px;
    position: relative;
  }

  .col-header-name {
    font-size: 13px;
    font-weight: 700;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .col-header-name:hover { color: #a78bfa; }

  .col-header-key {
    font-size: 10px;
    color: #475569;
    margin-top: 2px;
    word-break: break-all;
    line-height: 1.3;
    max-height: 32px;
    overflow: hidden;
    cursor: pointer;
  }
  .col-header-key:hover { color: #94a3b8; }
  .col-header-key.empty { color: #2d3248; font-style: italic; }

  .col-del-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    opacity: 0;
    cursor: pointer;
    color: #ef4444;
    font-size: 14px;
    line-height: 1;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }
  th:hover .col-del-btn { opacity: 1; }
  .col-del-btn:hover { background: #450a0a; }

  .th-num {
    background: #1a1d27;
    text-align: center;
    font-size: 11px;
    color: #475569;
    border: 1px solid #2d3248;
    padding: 8px 4px;
  }

  td {
    border: 1px solid #2d3248;
    padding: 0;
    vertical-align: top;
    background: #141720;
    position: relative;
  }
  td:hover { background: #1a1d27; }
  td:first-child {
    background: #1a1d27 !important;
    text-align: center;
    font-size: 11px;
    color: #475569;
    min-width: 48px;
    width: 48px;
    cursor: pointer;
    user-select: none;
  }
  td:first-child:hover { color: #ef4444; }

  .cell-input {
    width: 100%;
    height: 100%;
    min-height: 36px;
    background: transparent;
    border: none;
    outline: none;
    color: #e2e8f0;
    font-size: 12px;
    padding: 8px 10px;
    resize: none;
    font-family: 'Consolas', 'Monaco', monospace;
    line-height: 1.5;
    cursor: text;
  }
  .cell-input:focus {
    background: #0d1117;
    box-shadow: inset 0 0 0 2px #6d28d9;
  }

  /* ADD COL BUTTON (last th) */
  .th-add {
    background: #1a1d27;
    border: 1px dashed #2d3248;
    padding: 8px 12px;
    min-width: 120px;
    cursor: pointer;
    color: #475569;
    font-size: 13px;
    text-align: center;
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .th-add:hover { color: #a78bfa; border-color: #6d28d9; background: #1e1533; }

  /* ADD ROW */
  .add-row-tr td {
    border: 1px dashed #2d3248;
    background: transparent !important;
    text-align: center;
    padding: 8px;
    cursor: pointer;
    color: #475569;
    font-size: 13px;
  }
  .add-row-tr td:hover { color: #a78bfa; background: #1e1533 !important; }

  /* BUTTONS */
  .btn {
    padding: 7px 14px;
    border-radius: 8px;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .btn-primary {
    background: #6d28d9;
    color: #fff;
  }
  .btn-primary:hover { background: #7c3aed; }
  .btn-secondary {
    background: #1e293b;
    color: #94a3b8;
    border: 1px solid #2d3248;
  }
  .btn-secondary:hover { background: #252836; color: #e2e8f0; }
  .btn-sm { padding: 5px 10px; font-size: 12px; }
  .btn-full { width: 100%; justify-content: center; }

  /* MODAL */
  .modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    z-index: 200;
    align-items: center;
    justify-content: center;
  }
  .modal-overlay.open { display: flex; }
  .modal {
    background: #1a1d27;
    border: 1px solid #2d3248;
    border-radius: 12px;
    padding: 24px;
    width: 420px;
    max-width: 90vw;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .modal h3 { font-size: 16px; font-weight: 700; margin-bottom: 16px; color: #fff; }
  .modal label { font-size: 12px; color: #94a3b8; display: block; margin-bottom: 4px; margin-top: 12px; }
  .modal input, .modal textarea {
    width: 100%;
    background: #0f1117;
    border: 1px solid #2d3248;
    border-radius: 8px;
    padding: 9px 12px;
    color: #e2e8f0;
    font-size: 14px;
    outline: none;
    font-family: inherit;
    transition: border-color 0.15s;
  }
  .modal textarea { min-height: 80px; resize: vertical; font-family: monospace; font-size: 12px; }
  .modal input:focus, .modal textarea:focus { border-color: #6d28d9; }
  .modal-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

  /* TOAST */
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1e293b;
    border: 1px solid #2d3248;
    color: #e2e8f0;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    z-index: 300;
    opacity: 0;
    transform: translateY(8px);
    transition: all 0.2s;
    pointer-events: none;
  }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.success { border-color: #16a34a; color: #4ade80; }
  .toast.error { border-color: #dc2626; color: #f87171; }

  /* LOADING */
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: #475569;
    font-size: 14px;
    gap: 8px;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .spinner {
    width: 18px; height: 18px;
    border: 2px solid #2d3248;
    border-top-color: #6d28d9;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2d3248; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #3d4468; }
</style>
</head>
<body>

<div class="header">
  <h1>🚀 План залива</h1>
  <div class="header-sep"></div>
  <span id="save-status" style="font-size:12px;color:#475569;"></span>
</div>

<div class="layout">
  <!-- SIDEBAR -->
  <div class="sidebar">
    <div class="sidebar-title">Таблицы</div>
    <div class="sidebar-list" id="table-list"></div>
    <div class="sidebar-footer">
      <button class="btn btn-primary btn-full" onclick="openNewTableModal()">
        + Новая таблица
      </button>
    </div>
  </div>

  <!-- MAIN -->
  <div class="main" id="main-area">
    <div class="empty-state" id="empty-state">
      <div class="icon">📋</div>
      <h2>Выбери или создай таблицу</h2>
      <p>Нажми «Новая таблица» в левой панели</p>
    </div>
  </div>
</div>

<!-- MODAL: NEW TABLE -->
<div class="modal-overlay" id="modal-new-table">
  <div class="modal">
    <h3>Новая таблица</h3>
    <label>Название</label>
    <input id="new-table-name" type="text" placeholder="например: 6 7 июня" autofocus>
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal('modal-new-table')">Отмена</button>
      <button class="btn btn-primary" onclick="createTable()">Создать</button>
    </div>
  </div>
</div>

<!-- MODAL: EDIT COLUMN -->
<div class="modal-overlay" id="modal-edit-col">
  <div class="modal">
    <h3 id="modal-col-title">Колонка</h3>
    <label>Название источника</label>
    <input id="edit-col-name" type="text" placeholder="OUR APPS CHICKEN">
    <label>Ключ / ссылка</label>
    <textarea id="edit-col-key" placeholder="bndrnt000612&key=WqWL4M3B&sub3={sub3}"></textarea>
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal('modal-edit-col')">Отмена</button>
      <button class="btn btn-primary" onclick="saveColumn()">Сохранить</button>
    </div>
  </div>
</div>

<!-- MODAL: RENAME TABLE -->
<div class="modal-overlay" id="modal-rename-table">
  <div class="modal">
    <h3>Переименовать таблицу</h3>
    <label>Название</label>
    <input id="rename-table-name" type="text">
    <div class="modal-btns">
      <button class="btn btn-secondary" onclick="closeModal('modal-rename-table')">Отмена</button>
      <button class="btn btn-primary" onclick="renameTable()">Сохранить</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
// =====================
// STATE
// =====================
let tables = [];
let currentTableId = null;
let currentData = { columns: [], rows: [], cells: {} };
let saveTimer = null;
let editingColId = null;

// =====================
// INIT
// =====================
document.addEventListener('DOMContentLoaded', () => {
  loadTables();

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
    if (e.key === 'Enter' && e.target.closest('.modal')) {
      const modal = e.target.closest('.modal-overlay');
      if (modal && !e.target.matches('textarea')) {
        const primaryBtn = modal.querySelector('.btn-primary');
        if (primaryBtn) primaryBtn.click();
      }
    }
  });
});

// =====================
// TABLES
// =====================
async function loadTables() {
  try {
    const res = await fetch('/api/tables');
    tables = await res.json();
    renderSidebar();
    if (tables.length > 0 && !currentTableId) {
      selectTable(tables[0].id);
    }
  } catch (err) {
    showToast('Ошибка загрузки таблиц', 'error');
  }
}

function renderSidebar() {
  const list = document.getElementById('table-list');
  list.innerHTML = '';
  tables.forEach(t => {
    const item = document.createElement('div');
    item.className = 'table-item' + (t.id === currentTableId ? ' active' : '');
    item.innerHTML = \`
      <span class="table-item-name" title="\${escHtml(t.name)}">\${escHtml(t.name)}</span>
      <span class="table-item-del" onclick="deleteTable(event, \${t.id})">×</span>
    \`;
    item.addEventListener('click', () => selectTable(t.id));
    list.appendChild(item);
  });
}

function openNewTableModal() {
  document.getElementById('new-table-name').value = '';
  openModal('modal-new-table');
  setTimeout(() => document.getElementById('new-table-name').focus(), 50);
}

async function createTable() {
  const name = document.getElementById('new-table-name').value.trim();
  if (!name) return;
  try {
    const res = await fetch('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const table = await res.json();
    tables.unshift(table);
    closeModal('modal-new-table');
    renderSidebar();
    selectTable(table.id);
    showToast('Таблица создана', 'success');
  } catch (err) {
    showToast('Ошибка создания', 'error');
  }
}

async function deleteTable(e, id) {
  e.stopPropagation();
  if (!confirm('Удалить таблицу?')) return;
  try {
    await fetch(\`/api/tables/\${id}\`, { method: 'DELETE' });
    tables = tables.filter(t => t.id !== id);
    if (currentTableId === id) {
      currentTableId = null;
      showEmptyState();
    }
    renderSidebar();
    showToast('Таблица удалена');
  } catch (err) {
    showToast('Ошибка удаления', 'error');
  }
}

function openRenameModal() {
  if (!currentTableId) return;
  const t = tables.find(t => t.id === currentTableId);
  document.getElementById('rename-table-name').value = t ? t.name : '';
  openModal('modal-rename-table');
  setTimeout(() => document.getElementById('rename-table-name').focus(), 50);
}

async function renameTable() {
  const name = document.getElementById('rename-table-name').value.trim();
  if (!name) return;
  try {
    const res = await fetch(\`/api/tables/\${currentTableId}\`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const updated = await res.json();
    const idx = tables.findIndex(t => t.id === currentTableId);
    if (idx !== -1) tables[idx] = updated;
    closeModal('modal-rename-table');
    renderSidebar();
    document.querySelector('.toolbar-title').textContent = name;
    showToast('Переименовано', 'success');
  } catch (err) {
    showToast('Ошибка', 'error');
  }
}

// =====================
// TABLE DATA
// =====================
async function selectTable(id) {
  currentTableId = id;
  renderSidebar();
  showLoading();
  try {
    const res = await fetch(\`/api/tables/\${id}/data\`);
    currentData = await res.json();
    renderTable();
  } catch (err) {
    showToast('Ошибка загрузки данных', 'error');
  }
}

function showEmptyState() {
  document.getElementById('main-area').innerHTML = \`
    <div class="empty-state" id="empty-state">
      <div class="icon">📋</div>
      <h2>Выбери или создай таблицу</h2>
      <p>Нажми «Новая таблица» в левой панели</p>
    </div>\`;
}

function showLoading() {
  document.getElementById('main-area').innerHTML = \`
    <div class="loading"><div class="spinner"></div> Загрузка...</div>\`;
}

function renderTable() {
  const t = tables.find(t => t.id === currentTableId);
  const tableName = t ? t.name : 'Таблица';

  const { columns, rows, cells } = currentData;

  let html = \`
    <div class="toolbar">
      <span class="toolbar-title" onclick="openRenameModal()" title="Переименовать">\${escHtml(tableName)}</span>
      <button class="btn btn-secondary btn-sm" onclick="addColumn()">+ Колонка</button>
      <button class="btn btn-secondary btn-sm" onclick="addRow()">+ Строка</button>
    </div>
    <div class="table-wrapper">
      <table id="main-table">
        <thead>
          <tr>
            <th class="th-num col-num" style="border:1px solid #2d3248;"></th>\`;

  columns.forEach(col => {
    html += \`
            <th class="col-data">
              <div class="th-inner">
                <span class="col-del-btn" onclick="deleteColumn(\${col.id})">×</span>
                <div class="col-header-name" onclick="openEditColModal(\${col.id})">\${escHtml(col.name)}</div>
                <div class="col-header-key \${col.key_link ? '' : 'empty'}" onclick="openEditColModal(\${col.id})">
                  \${col.key_link ? escHtml(col.key_link) : 'нет ключа'}
                </div>
              </div>
            </th>\`;
  });

  html += \`
            <th class="th-add" onclick="addColumn()">+ колонка</th>
          </tr>
        </thead>
        <tbody>\`;

  rows.forEach((row, rowIdx) => {
    html += \`<tr>
              <td onclick="deleteRow(\${row.id})" title="Удалить строку">\${rowIdx + 1}</td>\`;
    columns.forEach(col => {
      const val = (cells[row.id] && cells[row.id][col.id]) ? cells[row.id][col.id] : '';
      html += \`<td>
                <textarea class="cell-input" 
                  data-row="\${row.id}" 
                  data-col="\${col.id}"
                  rows="1"
                  onchange="scheduleCell(this)"
                  oninput="autoResize(this)"
                >\${escHtml(val)}</textarea>
              </td>\`;
    });
    if (columns.length === 0) html += \`<td></td>\`;
    html += \`</tr>\`;
  });

  html += \`
          <tr class="add-row-tr">
            <td colspan="\${columns.length + 2}" onclick="addRow()">+ добавить строку</td>
          </tr>
        </tbody>
      </table>
    </div>\`;

  document.getElementById('main-area').innerHTML = html;

  // Auto-resize all textareas
  document.querySelectorAll('.cell-input').forEach(ta => autoResize(ta));
}

// =====================
// COLUMNS
// =====================
function addColumn() {
  editingColId = null;
  document.getElementById('modal-col-title').textContent = 'Новая колонка';
  document.getElementById('edit-col-name').value = '';
  document.getElementById('edit-col-key').value = '';
  openModal('modal-edit-col');
  setTimeout(() => document.getElementById('edit-col-name').focus(), 50);
}

function openEditColModal(colId) {
  const col = currentData.columns.find(c => c.id === colId);
  if (!col) return;
  editingColId = colId;
  document.getElementById('modal-col-title').textContent = 'Редактировать колонку';
  document.getElementById('edit-col-name').value = col.name;
  document.getElementById('edit-col-key').value = col.key_link || '';
  openModal('modal-edit-col');
  setTimeout(() => document.getElementById('edit-col-name').focus(), 50);
}

async function saveColumn() {
  const name = document.getElementById('edit-col-name').value.trim();
  const key_link = document.getElementById('edit-col-key').value.trim();
  if (!name) return;

  try {
    if (editingColId) {
      const res = await fetch(\`/api/columns/\${editingColId}\`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, key_link }),
      });
      const updated = await res.json();
      const idx = currentData.columns.findIndex(c => c.id === editingColId);
      if (idx !== -1) currentData.columns[idx] = updated;
    } else {
      const res = await fetch(\`/api/tables/\${currentTableId}/columns\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, key_link }),
      });
      const newCol = await res.json();
      currentData.columns.push(newCol);
    }
    closeModal('modal-edit-col');
    renderTable();
    showToast('Сохранено', 'success');
  } catch (err) {
    showToast('Ошибка', 'error');
  }
}

async function deleteColumn(colId) {
  if (!confirm('Удалить колонку и все её данные?')) return;
  try {
    await fetch(\`/api/columns/\${colId}\`, { method: 'DELETE' });
    currentData.columns = currentData.columns.filter(c => c.id !== colId);
    // Remove cells for this column
    for (const rowId in currentData.cells) {
      delete currentData.cells[rowId][colId];
    }
    renderTable();
    showToast('Колонка удалена');
  } catch (err) {
    showToast('Ошибка', 'error');
  }
}

// =====================
// ROWS
// =====================
async function addRow() {
  try {
    const res = await fetch(\`/api/tables/\${currentTableId}/rows\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const newRow = await res.json();
    currentData.rows.push(newRow);
    currentData.cells[newRow.id] = {};
    renderTable();
    // Focus first cell of new row
    const inputs = document.querySelectorAll('.cell-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  } catch (err) {
    showToast('Ошибка', 'error');
  }
}

async function deleteRow(rowId) {
  if (!confirm('Удалить строку?')) return;
  try {
    await fetch(\`/api/rows/\${rowId}\`, { method: 'DELETE' });
    currentData.rows = currentData.rows.filter(r => r.id !== rowId);
    delete currentData.cells[rowId];
    renderTable();
    showToast('Строка удалена');
  } catch (err) {
    showToast('Ошибка', 'error');
  }
}

// =====================
// CELLS
// =====================
function scheduleCell(textarea) {
  const rowId = textarea.dataset.row;
  const colId = textarea.dataset.col;
  const value = textarea.value;

  if (!currentData.cells[rowId]) currentData.cells[rowId] = {};
  currentData.cells[rowId][colId] = value;

  clearTimeout(saveTimer);
  setSaveStatus('Сохранение...');
  saveTimer = setTimeout(() => saveCell(rowId, colId, value), 600);
}

async function saveCell(rowId, colId, value) {
  try {
    await fetch('/api/cells', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_id: rowId, column_id: colId, value }),
    });
    setSaveStatus('Сохранено ✓');
    setTimeout(() => setSaveStatus(''), 2000);
  } catch (err) {
    setSaveStatus('Ошибка сохранения');
  }
}

function setSaveStatus(msg) {
  document.getElementById('save-status').textContent = msg;
}

// =====================
// UTILS
// =====================
function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(36, ta.scrollHeight) + 'px';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
</script>
</body>
</html>
`;

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML_PAGE);
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
