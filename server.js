require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'josify-lidea-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7日間
}));

// 認証チェックミドルウェア
function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  // APIへのリクエストは401を返す
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }
  // HTMLリクエストはloginページへ
  res.redirect('/login.html');
}

// 認証ルート（認証不要）
app.use('/auth', require('./routes/auth'));

// 静的ファイル（login.html, admin.htmlは認証不要）
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));
app.use('/admin.html', express.static(path.join(__dirname, 'public', 'admin.html')));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));

// 認証が必要なルート
app.use('/api/match', requireAuth, require('./routes/match'));
app.use('/api/draft', requireAuth, require('./routes/draft'));
app.use('/api/forms', requireAuth, require('./routes/forms'));

app.get('/api/subsidies', requireAuth, (req, res) => {
  res.json(require('./data/subsidies.json'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 認証が必要な静的ファイル
app.use(requireAuth, express.static(path.join(__dirname, 'public')));

app.get('*', requireAuth, (req, res) => {
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
