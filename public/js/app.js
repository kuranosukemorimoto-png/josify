/* ==============================
   Josify — メインアプリロジック
   ============================== */

const State = {
  currentStep: 1,
  company: {},
  matches: [],
  selectedSubsidies: [],
};

// ==============================
// ステップ制御
// ==============================
function goToStep(n) {
  // 現在のステップを非表示
  document.getElementById(`step-${State.currentStep}`).classList.remove('active');

  // progressノード更新
  for (let i = 1; i <= 3; i++) {
    const node = document.getElementById(`node-${i}`);
    const line = document.getElementById(`line-${i}-${i + 1}`);
    node.classList.remove('active', 'done');
    if (line) line.classList.remove('done');

    if (i < n) {
      node.classList.add('done');
      if (line) line.classList.add('done');
    } else if (i === n) {
      node.classList.add('active');
    }
  }

  State.currentStep = n;
  document.getElementById(`step-${n}`).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==============================
// Step 1: プロフィール送信
// ==============================
document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const goals = [...document.querySelectorAll('.checkbox-grid input:checked')].map(el => el.value);
  if (goals.length === 0) {
    alert('事業の目標・課題を1つ以上選択してください');
    return;
  }

  State.company = {
    company_name: document.getElementById('company-name').value,
    industry: document.getElementById('industry').value,
    employees: document.getElementById('employees').value,
    prefecture: document.getElementById('prefecture').value,
    established: document.getElementById('established').value,
    revenue: document.getElementById('revenue').value,
    capital: document.getElementById('capital').value,
    goals,
    description: document.getElementById('description').value,
  };

  goToStep(2);
  await runMatching();
});

// ==============================
// Step 2: マッチング
// ==============================
async function runMatching() {
  const loadingEl = document.getElementById('matching-loading');
  const listEl = document.getElementById('subsidy-list');
  const actionsEl = document.getElementById('step2-actions');

  loadingEl.classList.remove('hidden');
  listEl.classList.add('hidden');
  actionsEl.classList.add('hidden');

  try {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: State.company }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'マッチングAPIエラー');
    }

    const data = await res.json();
    State.matches = data.subsidies;

    loadingEl.classList.add('hidden');
    renderSubsidyList(State.matches);
    listEl.classList.remove('hidden');
    actionsEl.classList.remove('hidden');
    document.getElementById('data-notice').classList.remove('hidden');

  } catch (err) {
    loadingEl.innerHTML = `<div class="error-msg">⚠️ エラー: ${err.message}<br><button onclick="runMatching()" class="btn-primary" style="margin-top:16px">再試行</button></div>`;
  }
}

function renderSubsidyList(subsidies) {
  const listEl = document.getElementById('subsidy-list');

  if (subsidies.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#6B7280;">条件に合う補助金が見つかりませんでした。入力内容を変更してお試しください。</div>';
    return;
  }

  listEl.innerHTML = subsidies.map(s => `
    <div class="subsidy-card" data-id="${s.id}" onclick="toggleSubsidy('${s.id}', this)">
      <div class="card-top">
        <input type="checkbox" class="card-checkbox" id="check-${s.id}" onclick="event.stopPropagation()">
        <div class="card-title">
          <div class="card-name">${s.name}</div>
          <div class="card-short-name">${s.short_name} | ${s.administering_body}</div>
        </div>
      </div>
      <div class="card-meta">
        <span class="tag tag-category">${s.category}</span>
        <span class="tag tag-priority-${s.priority}">適合度：${s.priority} (${s.score}/10)</span>
        ${s.deadline ? `<span class="tag tag-deadline">🗓 締切：${escapeHtml(s.deadline)}</span>` : ''}
      </div>
      <div class="score-row">
        <span class="score-label">マッチ度</span>
        <div class="score-bar"><div class="score-fill" style="width:${s.score * 10}%"></div></div>
        <span class="score-value">${s.score}/10</span>
      </div>
      <div class="card-amount">
        <div class="amount-item">
          <div class="amount-label">最大補助額</div>
          <div class="amount-value">${s.max_amount}</div>
        </div>
        <div class="amount-item">
          <div class="amount-label">補助率</div>
          <div class="amount-value">${s.subsidy_rate}</div>
        </div>
        <div class="amount-item">
          <div class="amount-label">必要書類</div>
          <div class="amount-value">${s.required_documents.length}点</div>
        </div>
      </div>
      <div class="card-reason">💡 ${s.reason}</div>
      <div class="card-official-link" onclick="event.stopPropagation()">
        <a href="${escapeHtml(s.official_url || s.application_url)}" target="_blank" rel="noopener" class="btn-official">
          🔗 公式サイトで最新情報を確認
        </a>
      </div>
    </div>
  `).join('');
}

function toggleSubsidy(id, cardEl) {
  const checkbox = document.getElementById(`check-${id}`);
  checkbox.checked = !checkbox.checked;
  cardEl.classList.toggle('selected', checkbox.checked);

  if (checkbox.checked) {
    if (!State.selectedSubsidies.find(s => s.id === id)) {
      State.selectedSubsidies.push(State.matches.find(s => s.id === id));
    }
  } else {
    State.selectedSubsidies = State.selectedSubsidies.filter(s => s.id !== id);
  }

  const count = State.selectedSubsidies.length;
  document.getElementById('selected-count').textContent = count;
  document.getElementById('proceed-to-3').disabled = count === 0;
}

document.getElementById('back-to-1').addEventListener('click', () => goToStep(1));

document.getElementById('proceed-to-3').addEventListener('click', () => {
  if (State.selectedSubsidies.length === 0) return;
  goToStep(3);
  showDocuments();
});

// ==============================
// Step 3: 必要書類一覧表示
// ==============================
function showDocuments() {
  const container = document.getElementById('docs-container');
  container.innerHTML = '';

  for (const subsidy of State.selectedSubsidies) {
    const selfDocs = subsidy.required_documents.filter(d => !d.form_url);
    const formDocs = subsidy.required_documents.filter(d => d.form_url);

    const section = document.createElement('div');
    section.className = 'doc-subsidy-section';
    section.innerHTML = `
      <div class="doc-subsidy-header">
        <h3>${escapeHtml(subsidy.short_name)}</h3>
        <span class="doc-count">必要書類 ${subsidy.required_documents.length}点</span>
      </div>

      ${formDocs.length > 0 ? `
        <div class="doc-group">
          <div class="doc-group-label">📋 申請様式（公式サイトから取得）</div>
          ${formDocs.map(doc => `
            <div class="doc-item-row">
              <span class="doc-item-name">${escapeHtml(doc.name)}</span>
              <a href="${escapeHtml(doc.form_url)}" target="_blank" rel="noopener" class="btn-download"
                 onclick="event.stopPropagation()">
                🔗 様式を見る
              </a>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${selfDocs.length > 0 ? `
        <div class="doc-group">
          <div class="doc-group-label">✅ 自分で用意する書類</div>
          ${selfDocs.map((doc, i) => `
            <div class="checklist-item">
              <input type="checkbox" id="chk-${subsidy.id}-${i}">
              <label for="chk-${subsidy.id}-${i}">
                <span class="doc-item-name">${escapeHtml(doc.name)}</span>
                ${doc.how_to_obtain ? `<div class="doc-guidance">📍 ${escapeHtml(doc.how_to_obtain)}</div>` : ''}
              </label>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="doc-apply-row">
        <a href="${escapeHtml(subsidy.application_url)}" target="_blank" rel="noopener" class="btn-apply">
          🔗 公式申請ページで最新情報を確認 →
        </a>
      </div>
    `;
    container.appendChild(section);
  }
}

document.getElementById('back-to-2').addEventListener('click', () => goToStep(2));

document.getElementById('restart-btn').addEventListener('click', () => {
  State.currentStep = 1;
  State.company = {};
  State.matches = [];
  State.selectedSubsidies = [];

  document.getElementById('profile-form').reset();
  document.getElementById('selected-count').textContent = '0';
  document.getElementById('proceed-to-3').disabled = true;

  goToStep(1);
});

// ==============================
// Utility
// ==============================
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
