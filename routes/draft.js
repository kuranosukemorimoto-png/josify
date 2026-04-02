const express = require('express');
const router = express.Router();
const { draftDocument } = require('../services/claudeService');

router.post('/', async (req, res) => {
  const { company, subsidy } = req.body;

  if (!company || !subsidy) {
    return res.status(400).json({ error: '会社情報または補助金情報が不足しています' });
  }

  // Claude APIを最大3件並列で生成（コスト爆発・タイムアウト防止）
  const CONCURRENCY = 3;
  const docs = subsidy.required_documents;
  const allDocuments = [];

  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const batch = docs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async doc => {
      try {
        const content = await draftDocument(company, subsidy, doc);
        return { ...doc, generated_content: content, status: 'done' };
      } catch (err) {
        console.error(`ドラフト生成エラー (${doc.name}):`, err.message);
        return { ...doc, generated_content: null, status: 'error', error: err.message };
      }
    }));
    allDocuments.push(...batchResults);
  }

  res.json({
    subsidy_id: subsidy.id,
    subsidy_name: subsidy.name,
    documents: allDocuments,
    generated_at: new Date().toISOString(),
  });
});

module.exports = router;
