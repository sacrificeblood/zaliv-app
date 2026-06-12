const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
