const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/allowed-emails.json');

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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
router.get('/admin/emails', (req, res) => {
  const data = loadData();
  if (req.headers['x-admin-password'] !== data.admin_password) {
    return res.status(401).json({ error: 'パスワードが違います' });
  }
  res.json({ emails: data.emails });
});

// 管理者：メール追加
router.post('/admin/emails', (req, res) => {
  const data = loadData();
  if (req.headers['x-admin-password'] !== data.admin_password) {
    return res.status(401).json({ error: 'パスワードが違います' });
  }
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
router.delete('/admin/emails', (req, res) => {
  const data = loadData();
  if (req.headers['x-admin-password'] !== data.admin_password) {
    return res.status(401).json({ error: 'パスワードが違います' });
  }
  const { email } = req.body;
  data.emails = data.emails.filter(e => e.toLowerCase() !== email.toLowerCase());
  saveData(data);
  res.json({ emails: data.emails });
});

module.exports = router;
