const express = require('express');
const router = express.Router();
const JSZip = require('jszip');
const { classifyScrapedForms } = require('../services/claudeService');

// 公式ページからPDF/Wordリンクを自動抽出
router.get('/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'urlが必要です' });

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.5',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`ページ取得失敗: ${response.status}`);

    const html = await response.text();
    const baseUrl = new URL(url);

    // PDF・Wordファイルのリンクを抽出
    const linkPattern = /href=["']([^"']*\.(pdf|doc|docx|xlsx|xls|zip))["']/gi;
    const matches = [...html.matchAll(linkPattern)];

    const links = [...new Set(matches.map(m => {
      const href = m[1];
      try {
        return href.startsWith('http') ? href : new URL(href, baseUrl.origin).href;
      } catch {
        return null;
      }
    }))].filter(Boolean);

    // ページタイトルも取得
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : url;

    res.json({ links, pageTitle, source_url: url });
  } catch (err) {
    res.json({ links: [], error: err.message, source_url: url });
  }
});

// サーバー経由でファイルをプロキシ取得（直接ダウンロード）
router.get('/download', async (req, res) => {
  const { url, name } = req.query;
  if (!url) return res.status(400).json({ error: 'urlが必要です' });

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) throw new Error(`取得失敗: ${response.status}`);

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const filename = name || url.split('/').pop() || 'document';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: 'ダウンロード失敗: ' + err.message });
  }
});

// 複数URLをZIPで一括ダウンロード
router.post('/download-forms', async (req, res) => {
  const { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'URLの配列が必要です' });
  }

  try {
    const zip = new JSZip();
    let downloadCount = 0;

    // 各URLをダウンロード
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
          signal: AbortSignal.timeout(30000),
        });

        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const filename = url.split('/').pop() || `document_${downloadCount}.pdf`;
          zip.file(filename, buffer);
          downloadCount++;
        }
      } catch (err) {
        console.error(`URL取得失敗 (${url}):`, err.message);
      }
    }

    if (downloadCount === 0) {
      return res.status(500).json({ error: 'ファイルのダウンロードに失敗しました' });
    }

    // ZIPを生成
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="subsidies_documents.zip"`);
    res.send(zipBuffer);
  } catch (err) {
    res.status(500).json({ error: 'ZIP生成失敗: ' + err.message });
  }
});

// スクレイプ結果をAIで分類（申請書類のみ選別・日本語ラベル付き）
router.post('/classify', async (req, res) => {
  const { subsidyName, urls } = req.body;
  if (!subsidyName || !urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'subsidyNameとurls配列が必要です' });
  }

  try {
    const classified = await classifyScrapedForms(subsidyName, urls);
    res.json({ forms: classified });
  } catch (err) {
    res.status(500).json({ error: 'AI分類エラー: ' + err.message });
  }
});

module.exports = router;
