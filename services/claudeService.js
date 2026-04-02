const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODELS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
};

// jGrants APIから現在募集中の補助金を取得（都道府県フィルタリング付き）
async function fetchJGrantsSubsidies(keywords, prefecture) {
  const fetch = (await import('node-fetch')).default;
  const seen = new Set();
  const results = [];

  // 全国 + 該当都道府県の2パターンで検索
  const areaParams = ['全国'];
  if (prefecture) areaParams.push(prefecture);

  for (const keyword of keywords) {
    for (const area of areaParams) {
      try {
        const params = new URLSearchParams({
          keyword,
          acceptance: '1',
          sort: 'acceptance_end_datetime',
          order: 'ASC',
          target_area_search: area,
        });
        const url = `https://api.jgrants-portal.go.jp/exp/v1/public/subsidies?${params}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data.result)) continue;
        for (const s of data.result) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            results.push({
              id: s.id,
              name: s.title,
              administering_body: s.institution_name || '所管省庁',
              target_area: s.target_area_search || '全国',
              max_amount: s.subsidy_max_limit > 0 ? `${Math.round(s.subsidy_max_limit / 10000)}万円` : '要確認',
              subsidy_rate: '要確認',
              official_url: `https://www.jgrants-portal.go.jp/subsidy/${s.id}`,
              application_url: `https://www.jgrants-portal.go.jp/subsidy/${s.id}`,
              deadline: s.acceptance_end_datetime ? s.acceptance_end_datetime.slice(0, 10) : '要確認',
            });
          }
        }
      } catch (e) { /* スキップ */ }
    }
  }
  return results;
}

// 上位マッチした補助金の必要書類をClaudeで自動生成
async function generateRequiredDocuments(subsidies) {
  const prompt = `あなたは日本の補助金申請の専門家です。
以下の補助金について、申請に一般的に必要な書類を補助金ごとにリストアップしてください。

${subsidies.map(s => `- ID: ${s.id} | 名称: ${s.name}`).join('\n')}

各補助金について3〜5件の必要書類を生成してください。
typeは "draft"（自分で作成する書類）または "guidance"（第三者機関が発行する書類）を使用。

以下のJSON形式のみ返してください（説明文不要）:
{
  "補助金ID": [
    {"name": "書類名", "description": "内容の説明（1文）", "type": "draft"}
  ]
}`;

  const response = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text?.trim() || '';
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return {};
  }
}

// 目標・課題別の補助金キーワードマップ（有名補助金名を直接含む）
const GOAL_KEYWORDS = {
  '設備投資・機械導入':     ['ものづくり補助金', 'IT導入補助金', '設備投資', '機械設備導入'],
  'DX・IT化推進':           ['IT導入補助金', 'デジタル化', 'DX推進', 'IT活用'],
  '人材採用':               ['キャリアアップ助成金', '雇用調整助成金', '人材確保', '採用助成'],
  '人材育成・研修':         ['人材開発支援助成金', 'キャリアアップ助成金', '職業訓練', '教育訓練'],
  '販路拡大・マーケティング': ['小規模事業者持続化補助金', '販路開拓', '展示会', '海外展開'],
  '生産性向上・業務効率化': ['業務改善助成金', 'IT導入補助金', '生産性向上', '効率化'],
  '事業拡大・新規展開':     ['事業再構築補助金', '小規模事業者持続化補助金', '新規事業'],
  '賃金引き上げ':           ['業務改善助成金', 'キャリアアップ助成金', '賃上げ', '最低賃金'],
  '省エネ・脱炭素':         ['省エネルギー', 'CO2削減', '再生可能エネルギー', '脱炭素'],
  '事業承継・M&A':          ['事業承継補助金', '後継者育成', '経営承継'],
  '研究開発・新技術':       ['研究開発', '新技術開発', 'SBIR', 'イノベーション'],
  '業態転換・新分野展開':   ['事業再構築補助金', '業態転換', '新分野展開'],
};

// 業種別の基本キーワードマップ
const INDUSTRY_KEYWORDS = {
  '製造業':         ['製造', 'ものづくり', '設備投資', '生産性向上', '工場'],
  'IT・情報通信業': ['IT', 'デジタル', 'システム開発', 'DX', 'ソフトウェア'],
  '建設業':         ['建設', '建築', '施工', '工事', '建設工事'],
  '小売業':         ['小売', '店舗', '販売', '商店', '流通'],
  '卸売業':         ['卸売', '流通', '販路', '商流', '卸'],
  '飲食業':         ['飲食', '食品', 'レストラン', '食堂', 'フード'],
  'サービス業':     ['サービス', '事業者支援', '生産性', 'サービス業'],
  '医療・福祉':     ['医療', '福祉', '介護', 'クリニック', '社会福祉'],
  '農業・林業・水産業': ['農業', '農産物', '林業', '水産', '農林水産'],
  '運輸・物流':     ['運輸', '物流', '輸送', 'トラック', '運送'],
  '不動産業':       ['不動産', '宅地', '建物', '賃貸', '土地'],
  '教育・学習支援': ['教育', '学習', '人材育成', '研修', 'スクール'],
  'その他':         ['中小企業', '事業者', '経営改善'],
};

// Step0: 業種マップ＋目標マップ＋Claude で会社情報から最適な検索キーワードを生成
async function generateSearchKeywords(company) {
  // ① 業種別の基本キーワード
  const industryKeywords = INDUSTRY_KEYWORDS[company.industry] || ['中小企業', '事業者'];

  // ② 目標・課題別のキーワード（有名補助金名含む）
  const goalKeywords = (company.goals || []).flatMap(g => GOAL_KEYWORDS[g] || []);

  // ③ Claudeが事業概要・規模・地域からマニアックなものを追加
  const prompt = `あなたは日本の補助金・助成金の専門家です。
以下の事業者プロフィールを見て、まだ検索に使っていない追加キーワードを生成してください。

【事業者プロフィール】
業種: ${company.industry}
従業員数: ${company.employees}
所在地: ${company.prefecture}
年商: ${company.revenue}
資本金: ${company.capital || '不明'}
設立年数: ${company.established}
目標・課題: ${(company.goals || []).join('、')}
事業概要: ${company.description || '特になし'}

【既に使用するキーワード（重複不要）】
${[...industryKeywords, ...goalKeywords].join('、')}

【追加キーワードの観点】
・規模: 従業員数・年商・設立年数から（例: 5人以下→「小規模事業者」、3年以内→「創業補助金」）
・地域: 所在地の地域産業・振興施策
・事業概要: 自由記述から連想されるニッチな補助金キーワード
・中小企業庁・厚生労働省・経産省等の各省庁別補助金

【ルール】
- 既存キーワードと重複しないこと
- 業種と無関係なキーワードは含めない
- 3〜5個をJSON配列のみで返す

JSON配列のみ返してください:`;

  let claudeKeywords = [];
  try {
    const res = await client.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.find(b => b.type === 'text')?.text?.trim() || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (match) claudeKeywords = JSON.parse(match[0]);
  } catch (e) { /* スキップ */ }

  // 全キーワードを重複なく結合
  const all = [...new Set([...industryKeywords, ...goalKeywords, ...claudeKeywords])];
  return all;
}

async function matchSubsidies(company) {
  // Step0: Claudeが会社情報から最適な検索キーワードを生成
  const keywords = await generateSearchKeywords(company);

  // Step1: jGrants APIから現在募集中の補助金を取得（都道府県フィルタ付き）
  let allSubsidies = await fetchJGrantsSubsidies(keywords, company.prefecture);

  // jGrants APIが空ならsubsidies.jsonにフォールバック
  if (allSubsidies.length === 0) {
    const subsidiesPath = path.join(__dirname, '../data/subsidies.json');
    const localData = JSON.parse(fs.readFileSync(subsidiesPath, 'utf8'));
    return matchWithLocalData(company, localData);
  }

  // Step2: Claude Haikuでスコアリング・上位5件を選ぶ
  const scoringPrompt = `あなたは日本の補助金・助成金の専門家です。
以下の事業者に最も適した補助金をスコアリングして上位5件を選んでください。

【事業者プロフィール】
業種: ${company.industry}
従業員数: ${company.employees}
所在地: ${company.prefecture}
年商: ${company.revenue}
資本金: ${company.capital || '不明'}
設立年数: ${company.established}
目標・課題: ${company.goals.join('、')}
事業概要: ${company.description || '特になし'}

【補助金リスト（現在募集中）】
${JSON.stringify(allSubsidies.slice(0, 60).map(s => ({
  id: s.id,
  name: s.name,
  target_area: s.target_area,
  max_amount: s.max_amount,
  deadline: s.deadline,
})), null, 2)}

【絶対ルール — 必ず守ること】
- 対象地域が「全国」または「${company.prefecture}」の補助金のみ選ぶ
- 他の都道府県・地域限定の補助金は絶対に含めない（例：東京都限定・北海道限定などは除外）
- 事業者の業種と全く無関係な補助金は絶対に含めない（例：建設業者にCO2削減・農業・水産業等は不可）
- 事業者の規模・従業員数・年商の要件を満たさない補助金は除外
- 事業者の目標・課題に全く合致しない補助金は除外
- 少しでも関連性が低いと判断した場合はスコア6以下として除外すること
- スコア7以上を最大5件選ぶ（該当なければ件数が少なくてもよい）
- JSONのみ返す（説明文不要）

[{
  "id": "補助金ID",
  "name": "正式名称",
  "short_name": "通称（略称）",
  "administering_body": "実施機関",
  "category": "カテゴリ",
  "score": 1〜10,
  "priority": "高/中/低",
  "reason": "この事業者に適している理由（2文以内）",
  "max_amount": "最大補助額",
  "subsidy_rate": "補助率（不明なら要確認）",
  "deadline": "締切日",
  "official_url": "公式URL",
  "application_url": "申請URL"
}]
priorityはscore 8以上=「高」、6-7=「中」、5以下=「低」`;

  const scoringRes = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 3000,
    messages: [{ role: 'user', content: scoringPrompt }],
  });

  const scoreText = scoringRes.content.find(b => b.type === 'text')?.text?.trim() || '';
  const cleanedScore = scoreText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const s1 = cleanedScore.indexOf('[');
  const s2 = cleanedScore.lastIndexOf(']');
  if (s1 === -1 || s2 === -1) throw new Error('マッチング結果のJSON解析に失敗しました');
  const topMatches = JSON.parse(cleanedScore.slice(s1, s2 + 1));

  // Step3: 必要書類をClaudeで自動生成
  const docsMap = await generateRequiredDocuments(topMatches);

  // 必要書類を付与して返す
  return topMatches
    .sort((a, b) => b.score - a.score)
    .map(item => ({
      ...item,
      required_documents: docsMap[item.id] || [],
    }));
}

// ローカルデータを使ったフォールバック用マッチング
async function matchWithLocalData(company, allSubsidies) {
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
  id: s.id, name: s.name, max_amount: s.max_amount,
  subsidy_rate: s.subsidy_rate, eligibility: s.eligibility, scoring_hints: s.scoring_hints,
})), null, 2)}

【ルール】
- スコア7以上を最大5件・JSONのみ返す

[{
  "id": "補助金ID",
  "name": "正式名称",
  "short_name": "通称",
  "administering_body": "実施機関",
  "category": "カテゴリ",
  "score": 1〜10,
  "priority": "高/中/低",
  "reason": "理由（2文以内）",
  "deadline": "公式サイトで要確認",
  "max_amount": "最大補助額",
  "subsidy_rate": "補助率",
  "official_url": "公式URL",
  "application_url": "申請URL",
  "required_documents": []
}]`;

  const response = await client.messages.create({
    model: MODELS.HAIKU,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text?.trim() || '';
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('マッチング結果のJSON解析に失敗しました');
  const matched = JSON.parse(cleaned.slice(start, end + 1));

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
