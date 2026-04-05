#!/usr/bin/env node
/**
 * 補助金URL死活チェッカー
 * subsidies.json + claudeService.js 内の全URLを検証
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// subsidies.json 読み込み
const subsidies = JSON.parse(readFileSync(join(__dirname, '../data/subsidies.json'), 'utf8'));

// 全URLを収集
const urlEntries = [];

for (const s of subsidies) {
  if (s.official_url) urlEntries.push({ name: s.name, field: 'official_url', url: s.official_url });
  if (s.application_url) urlEntries.push({ name: s.name, field: 'application_url', url: s.application_url });
  // required_documents 内の form_url
  for (const doc of (s.required_documents || [])) {
    if (doc.form_url) urlEntries.push({ name: `${s.name} > ${doc.name}`, field: 'form_url', url: doc.form_url });
  }
}

console.log(`\n🔍 ${urlEntries.length} 件のURLをチェック中...\n`);

let ok = 0;
let ng = 0;
const errors = [];

for (const entry of urlEntries) {
  try {
    const res = await fetch(entry.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok || res.status === 405) {
      // 405 = HEAD非対応だがサーバーは生きてる
      console.log(`  ✅ ${entry.name} — ${entry.url}`);
      ok++;
    } else {
      console.log(`  ❌ ${entry.name} — ${entry.url} (HTTP ${res.status})`);
      errors.push({ ...entry, error: `HTTP ${res.status}` });
      ng++;
    }
  } catch (e) {
    console.log(`  ❌ ${entry.name} — ${entry.url} (${e.cause?.code || e.message})`);
    errors.push({ ...entry, error: e.cause?.code || e.message });
    ng++;
  }
}

console.log(`\n========================================`);
console.log(`✅ OK: ${ok}件  ❌ NG: ${ng}件`);

if (errors.length > 0) {
  console.log(`\n⚠️  修正が必要なURL:`);
  for (const e of errors) {
    console.log(`  - ${e.name}`);
    console.log(`    ${e.field}: ${e.url}`);
    console.log(`    エラー: ${e.error}\n`);
  }
}
