const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// 永続ディスク（PERSIST_DIR）があればそちらを使う。なければローカルdata/
const PERSIST_DIR = process.env.PERSIST_DIR || path.join(__dirname, '../data');
const DATA_FILE = path.join(PERSIST_DIR, 'allowed-emails.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = { emails: [], admin_password: 'lidea2026' };
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// 管理者パスワード検証（環境変数優先）
function isValidAdminPassword(pw) {
  const correct = process.env.ADMIN_PASSWORD || loadData().admin_password;
  return pw === correct;
}

// 管理者セッション認証ミドルウェア
function requireAdminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'];
  if (!pw || !isValidAdminPassword(pw)) {
    return res.status(401).json({ error: 'パスワードが違います' });
  }
  next();
}

// メールアドレスでログイン
router.post('/login', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'メールアドレスを入力してください' });

  const data = loadData();
  const normalizedEmail = email.toLowerCase().trim();

  if (!data.emails.map(e => e.toLowerCase()).includes(normalizedEmail)) {
    return res.status(401).json({ error: 'このメールアドレスはご利用いただけません。LIDEAとのご契約をご確認ください。' });
  }

  req.session.email = normalizedEmail;
  req.session.loggedIn = true;
  res.json({ ok: true });
});

// ログアウト
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// 管理者：メール一覧取得
router.get('/admin/emails', requireAdminAuth, (req, res) => {
  const data = loadData();
  res.json({ emails: data.emails });
});

// 管理者：メール追加
router.post('/admin/emails', requireAdminAuth, (req, res) => {
  const data = loadData();
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'メールアドレスが必要です' });

  const normalized = email.toLowerCase().trim();
  if (data.emails.map(e => e.toLowerCase()).includes(normalized)) {
    return res.status(400).json({ error: '既に登録済みです' });
  }

  data.emails.push(normalized);
  saveData(data);
  res.json({ emails: data.emails });
});

// 管理者：メール削除
router.delete('/admin/emails', requireAdminAuth, (req, res) => {
  const data = loadData();
  const { email } = req.body;
  data.emails = data.emails.filter(e => e.toLowerCase() !== email.toLowerCase());
  saveData(data);
  res.json({ emails: data.emails });
});

module.exports = router;
