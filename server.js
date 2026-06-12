const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  try {
    const r = await pool.query('SELECT * FROM sources ORDER BY position, id');
    res.json(r.rows);
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/sources', async (req, res) => {
  try {
    const { name, key_link } = req.body;
    const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS p FROM sources');
    const r = await pool.query('INSERT INTO sources(name,key_link,position) VALUES($1,$2,$3) RETURNING *',
      [name, key_link||'', pos.rows[0].p]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.patch('/api/sources/:id', async (req, res) => {
  try {
    const r = await pool.query('UPDATE sources SET name=$1,key_link=$2 WHERE id=$3 RETURNING *',
      [req.body.name, req.body.key_link||'', req.params.id]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.delete('/api/sources/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sources WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/campaigns', async (req, res) => {
  try {
    const { date } = req.query;
    let q = 'SELECT c.*, s.name as source_name FROM campaigns c LEFT JOIN sources s ON c.source_id=s.id';
    const params = [];
    if (date) { q += ' WHERE c.plan_date=$1'; params.push(date); }
    q += ' ORDER BY c.source_id, c.platform DESC, c.position, c.id';
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/dates', async (req, res) => {
  try {
    const r = await pool.query('SELECT DISTINCT plan_date FROM campaigns ORDER BY plan_date DESC');
    res.json(r.rows.map(row => row.plan_date.toISOString().slice(0,10)));
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const { source_id, geo, creative, assistant, platform, neyming, plan_date } = req.body;
    const pos = await pool.query(
      'SELECT COALESCE(MAX(position),0)+1 AS p FROM campaigns WHERE source_id=$1 AND plan_date=$2',
      [source_id, plan_date]);
    const r = await pool.query(
      'INSERT INTO campaigns(source_id,geo,creative,assistant,platform,neyming,plan_date,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [source_id, geo, creative, assistant||'', platform, neyming, plan_date, pos.rows[0].p]);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM campaigns WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => console.log('Server running on port ' + PORT));
}).catch(err => { console.error(err); process.exit(1); });
