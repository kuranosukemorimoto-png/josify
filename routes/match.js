const express = require('express');
const router = express.Router();
const { matchSubsidies } = require('../services/claudeService');

router.post('/', async (req, res) => {
  const { company } = req.body;

  if (!company || !company.industry || !company.employees) {
    return res.status(400).json({ error: '会社情報が不足しています' });
  }

  try {
    const subsidies = await matchSubsidies(company);
    res.json({ subsidies, total: subsidies.length });
  } catch (err) {
    console.error('マッチングエラー:', err.message);
    res.status(500).json({ error: 'マッチング処理中にエラーが発生しました: ' + err.message });
  }
});

module.exports = router;
