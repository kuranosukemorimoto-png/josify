const express = require('express');
const router = express.Router();
const { draftDocument } = require('../services/claudeService');

router.post('/', async (req, res) => {
  const { company, subsidy } = req.body;

  if (!company || !subsidy) {
    return res.status(400).json({ error: '会社情報または補助金情報が不足しています' });
  }

  // 全書類をClaude APIで並列生成（type問わず全て下書き作成）
  const draftPromises = subsidy.required_documents.map(async doc => {
    try {
      const content = await draftDocument(company, subsidy, doc);
      return { ...doc, generated_content: content, status: 'done' };
    } catch (err) {
      console.error(`ドラフト生成エラー (${doc.name}):`, err.message);
      return { ...doc, generated_content: null, status: 'error', error: err.message };
    }
  });

  const allDocuments = await Promise.all(draftPromises);

  res.json({
    subsidy_id: subsidy.id,
    subsidy_name: subsidy.name,
    documents: allDocuments,
    generated_at: new Date().toISOString(),
  });
});

module.exports = router;
