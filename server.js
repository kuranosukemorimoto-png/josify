require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/match', require('./routes/match'));
app.use('/api/draft', require('./routes/draft'));
app.use('/api/forms', require('./routes/forms'));

app.get('/api/subsidies', (req, res) => {
  res.json(require('./data/subsidies.json'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   ⚡ Josify サーバー起動完了         ║
  ║   → http://localhost:${PORT}           ║
  ╚══════════════════════════════════════╝
  `);
});
