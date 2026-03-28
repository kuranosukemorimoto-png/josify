const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODELS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
};

async function matchSubsidies(company) {
  // subsidies.jsonから補助金データを読み込む
  const subsidiesPath = path.join(__dirname, '../data/subsidies.json');
  const allSubsidies = JSON.parse(fs.readFileSync(subsidiesPath, 'utf8'));

  const prompt = `あなたは日本の補助金・助成金の専門家です。

以下の事業者プロフィールと補助金リストを照らし合わせて、適合度をスコアリングしてください。

【事業者プロフィール】
業種: ${company.industry}
従業員数: ${company.employees}
所在地: ${company.prefecture}
年商: ${company.revenue}
設立年数: ${company.established}
目標・課題: ${company.goals.join('、')}
事業概要: ${company.description || '特になし'}

【補助金リスト】
${JSON.stringify(allSubsidies.map(s => ({
  id: s.id,
  name: s.name,
  short_name: s.short_name,
  category: s.category,
  administering_body: s.administering_body,
  max_amount: s.max_amount,
  subsidy_rate: s.subsidy_rate,
  official_url: s.official_url,
  application_url: s.application_url,
  eligibility: s.eligibility,
  scoring_hints: s.scoring_hints,
  tags: s.tags,
})), null, 2)}

【ルール】
- 上記リストの補助金のみ使用（リスト外の補助金は追加しない）
- スコア7以上の補助金を全て返す（最低1件・最大5件）
- required_documentsは元データから引用すること
- 最後にJSONのみ返す（説明文・マークダウン不要）

以下のJSON形式で返してください:
[{
  "id": "補助金ID（リストのIDをそのまま使用）",
  "name": "正式名称",
  "short_name": "通称",
  "administering_body": "実施機関",
  "category": "カテゴリ",
  "score": 1〜10,
  "priority": "高/中/低",
  "reason": "この事業者に適している理由（2文以内）",
  "deadline": "公式サイトで要確認",
  "max_amount": "最大補助額",
  "subsidy_rate": "補助率",
  "official_url": "公式URL",
  "application_url": "申請URL",
  "required_documents": []
}]
priorityはscore 8以上=「高」、6-7=「中」、5以下=「低」`;

  const response = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text?.trim() || '';

  // コードブロック除去してからJSON配列を抽出
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('マッチング結果のJSON解析に失敗しました');
  const matched = JSON.parse(cleaned.slice(start, end + 1));

  // required_documentsを元データから補完
  return matched
    .sort((a, b) => b.score - a.score)
    .map(item => {
      const original = allSubsidies.find(s => s.id === item.id);
      return { ...item, required_documents: original?.required_documents || [] };
    });
}

async function draftDocument(company, subsidy, document) {
  // 書類タイプ別の追加指示
  const typeInstructions = {
    draft: `実際の申請書として使用できる完全な下書きを作成してください。事業計画書・計画書類は1,500〜3,000字程度で詳細に記述すること。`,
    link: `この書類は公式様式への記入が必要です。以下を作成してください：
① 記入すべき内容の完全な下書き（実際の様式に転記できるレベルで）
② 各項目の記入ポイント・注意事項
③ 公式フォーム入手先: ${document.form_url || '各省庁・機関の公式サイト'}`,
    guidance: `この書類は第三者機関が発行するものですが、以下を作成してください：
① 書類に記載される内容の参考テンプレート（どんな情報が必要かわかるように）
② 取得するための具体的な手順・連絡先
③ 取得時に必要な情報・書類のチェックリスト
参考情報: ${document.how_to_obtain || ''}`,
  };

  const extraInstruction = typeInstructions[document.type] || typeInstructions.draft;

  const prompt = `あなたは日本の補助金・助成金申請の専門家です。
以下の情報を基に「${document.name}」を作成してください。

【補助金名】${subsidy.name}

【申請事業者情報】
会社名: ${company.company_name || '（会社名）'}
業種: ${company.industry}
従業員数: ${company.employees}名
所在地: ${company.prefecture}
年商: ${company.revenue}
設立年数: ${company.established}年
事業の目標: ${company.goals.join('、')}
事業概要: ${company.description || ''}

【書類の概要】
${document.description}
${document.notes ? '注意点: ' + document.notes : ''}

【作成指示】
${extraInstruction}

【共通ルール】
- 実用的な日本語で作成（そのまま使える・参考にできるレベル）
- 修正が必要な箇所は【要確認: 内容】の形式で明示
- 不明な数値は【要入力: 項目名】で記載
- 見出し（##）で構成を整理`;

  const response = await client.messages.create({
    model: MODELS.SONNET,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

async function classifyScrapedForms(subsidyName, urls) {
  const prompt = `補助金「${subsidyName}」の公式ページから以下のファイルURLが見つかりました。
申請者が実際に必要な「申請書類・様式・申請フォーム」のみを選別し、わかりやすい日本語名を付けてください。

【除外するもの】
- FAQ・よくある質問
- 説明会・セミナー資料
- 参考資料・手引き・ガイドライン
- 採択事例・事例集
- 報告書・審査結果

【対象URL一覧】
${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}

申請書類として必要なものだけを選び、以下のJSON配列のみを返してください。説明文・マークダウン不要。
[{"url":"URL","label":"申請書（様式1）などの日本語名"}]

1件も該当しない場合は空配列 [] を返してください。`;

  const response = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
}

module.exports = { matchSubsidies, draftDocument, classifyScrapedForms };
