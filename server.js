const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ══════════════════════════════════════════
//  STOCKAGE : PostgreSQL (Railway) OU fichier local
//  Railway injecte DATABASE_URL automatiquement
// ══════════════════════════════════════════

const USE_PG = !!process.env.DATABASE_URL;
const DATA_FILE = path.join(__dirname, 'planning_data.json');

let pool = null;
if (USE_PG) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('  📦 Stockage : PostgreSQL (Railway)');
} else {
  console.log('  📁 Stockage : fichier local (planning_data.json)');
}

// ── Données par défaut ──
function defaultData() {
  return {
    people: [
      { name: 'Valentin', color: '#FFCC00' },
      { name: 'Carine',   color: '#4FC3F7' },
      { name: 'Gaëlle',   color: '#81C784' },
    ],
    weekShifts: {},
    defaultShifts: {
      Valentin: {
        Lundi:    [[7.5,12],[14,19]],
        Mardi:    [[7.5,12],[14,19]],
        Mercredi: [[7.5,12],[14,19]],
        Jeudi:    [[7.5,12],[14,19]],
        Vendredi: [[7.5,12],[14,19]],
      },
      Carine: {
        Lundi:    null,
        Mardi:    [[7.5,12],[14,18.25]],
        Mercredi: [[7.5,12],[14,18.25]],
        Jeudi:    [[7.5,12],[14,18.25]],
        Vendredi: [[7.5,12],[14,18.25]],
      },
      Gaëlle: {
        Lundi:    [[7.5,12],[14,18.25]],
        Mardi:    [[7.5,12],[14,18.25]],
        Mercredi: [[7.5,12],[14,18.25]],
        Jeudi:    [[7.5,12],[14,18.25]],
        Vendredi: null,
      },
    }
  };
}

// ── Init table PostgreSQL ──
async function initDB() {
  if (!USE_PG) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS planning (
      id   TEXT PRIMARY KEY DEFAULT 'main',
      data JSONB NOT NULL
    )
  `);
  // Insérer les données par défaut si table vide
  const res = await pool.query("SELECT id FROM planning WHERE id='main'");
  if (res.rowCount === 0) {
    await pool.query(
      "INSERT INTO planning(id, data) VALUES('main', $1)",
      [JSON.stringify(defaultData())]
    );
    console.log('  ✅ Données initiales insérées en base');
  }
}

// ── Lire données ──
async function readData() {
  if (USE_PG) {
    const res = await pool.query("SELECT data FROM planning WHERE id='main'");
    if (res.rowCount === 0) return defaultData();
    return res.rows[0].data;
  } else {
    try {
      if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch(e) {}
    const d = defaultData();
    writeDataSync(d);
    return d;
  }
}

// ── Écrire données ──
async function writeData(data) {
  if (USE_PG) {
    await pool.query(
      "UPDATE planning SET data=$1 WHERE id='main'",
      [JSON.stringify(data)]
    );
  } else {
    writeDataSync(data);
  }
}

function writeDataSync(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ══════════════════════════════════════════
//  ROUTES API
// ══════════════════════════════════════════

app.get('/api/data', async (req, res) => {
  try { res.json(await readData()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/data', async (req, res) => {
  try { await writeData(req.body); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/person/add', async (req, res) => {
  try {
    const { name, color } = req.body;
    const data = await readData();
    if (data.people.find(p => p.name === name))
      return res.status(400).json({ error: 'Nom déjà utilisé' });
    data.people.push({ name, color });
    data.defaultShifts[name] = {
      Lundi:    [[7.5,12],[14,18.25]],
      Mardi:    [[7.5,12],[14,18.25]],
      Mercredi: [[7.5,12],[14,18.25]],
      Jeudi:    [[7.5,12],[14,18.25]],
      Vendredi: [[7.5,12],[14,18.25]],
    };
    await writeData(data);
    res.json({ ok: true, data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/person/rename', async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    const data = await readData();
    const p = data.people.find(p => p.name === oldName);
    if (!p) return res.status(404).json({ error: 'Personne introuvable' });
    if (data.people.find(p => p.name === newName))
      return res.status(400).json({ error: 'Nom déjà utilisé' });
    p.name = newName;
    if (data.defaultShifts[oldName]) {
      data.defaultShifts[newName] = data.defaultShifts[oldName];
      delete data.defaultShifts[oldName];
    }
    for (const wk of Object.keys(data.weekShifts)) {
      if (data.weekShifts[wk][oldName]) {
        data.weekShifts[wk][newName] = data.weekShifts[wk][oldName];
        delete data.weekShifts[wk][oldName];
      }
    }
    await writeData(data);
    res.json({ ok: true, data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/person/remove', async (req, res) => {
  try {
    const { name } = req.body;
    const data = await readData();
    data.people = data.people.filter(p => p.name !== name);
    delete data.defaultShifts[name];
    for (const wk of Object.keys(data.weekShifts)) delete data.weekShifts[wk][name];
    await writeData(data);
    res.json({ ok: true, data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Export données brutes (backup) ──
app.get('/api/export', async (req, res) => {
  try {
    const data = await readData();
    res.setHeader('Content-Disposition', 'attachment; filename="planning_backup.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Import données (restauration) ──
app.post('/api/import', async (req, res) => {
  try {
    const data = req.body;
    if (!data.people || !data.defaultShifts) return res.status(400).json({ error: 'Fichier invalide' });
    await writeData(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Santé ──
app.get('/api/health', (req, res) => {
  res.json({ ok: true, storage: USE_PG ? 'postgresql' : 'file', ts: new Date().toISOString() });
});

// ══════════════════════════════════════════
//  DÉMARRAGE
// ══════════════════════════════════════════
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces))
    for (const iface of ifaces[name])
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  return 'localhost';
}

async function start() {
  await initDB();
  app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('');
    console.log('  ╔════════════════════════════════════════════════╗');
    console.log('  ║   🚗  RENAULT TOURNEFEUILLE — Planning         ║');
    console.log('  ╠════════════════════════════════════════════════╣');
    if (!USE_PG) {
    console.log(`  ║   Local  :  http://localhost:${PORT}               ║`);
    console.log(`  ║   Réseau :  http://${ip}:${PORT}          ║`);
    console.log('  ╠════════════════════════════════════════════════╣');
    console.log('  ║   Partagez cette adresse réseau à vos collègues║');
    } else {
    console.log(`  ║   ✅ Déployé sur Railway avec PostgreSQL        ║`);
    console.log(`  ║   Données persistantes garanties               ║`);
    }
    console.log('  ╚════════════════════════════════════════════════╝');
    console.log('');
  });
}

start().catch(err => {
  console.error('Erreur démarrage :', err);
  process.exit(1);
});
