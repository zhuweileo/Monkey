// Sidepanel — main interaction controller
// All AI calls happen here (persistent page, no SW 30s timeout)

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  currentTab: 'generate',
  generatePhase: 'input',
  lastDescription: '',
  lastCode: '',
  lastPattern: '',
  lastUserInput: '',
  abortController: null,
  scripts: [],
  editingId: null,
  targetTabId: null,   // tab where user typed the prompt — captured in startGenerate
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const els = {
  noKey: $('state-no-key'),
  app: $('app'),

  tabGenerate: $('tab-generate'),
  tabScripts: $('tab-scripts'),
  scriptsBadge: $('scripts-badge'),
  panelGenerate: $('tab-panel-generate'),
  panelScripts: $('tab-panel-scripts'),

  // generate states
  stateInput: $('state-input'),
  stateStreaming: $('state-streaming'),
  stateConfirm: $('state-confirm'),
  stateSuccess: $('state-success'),
  stateError: $('state-error'),

  // input state
  userInput: $('user-input'),
  btnGenerate: $('btn-generate'),

  // streaming state
  streamingPreview: $('streaming-preview'),
  streamingCodePreview: $('streaming-code-preview'),
  btnCancel: $('btn-cancel'),

  // confirm state
  existingNotice: $('existing-notice'),
  existingNoticeText: $('existing-notice-text'),
  descriptionBody: $('description-body'),
  descriptionExpand: $('description-expand'),
  codeToggle: $('code-toggle'),
  codeBlock: $('code-block'),
  codeContent: $('code-content'),
  urlPattern: $('url-pattern'),
  patternError: $('pattern-error'),
  trustText: null,
  btnConfirm: $('btn-confirm'),
  btnRegenerate: $('btn-regenerate'),

  // error state
  errorMessage: $('error-message'),
  btnRetry: $('btn-retry'),
  btnErrorSettings: $('btn-error-settings'),

  // scripts tab
  scriptsEmpty: $('scripts-empty'),
  scriptList: $('script-list'),
  btnGoGenerate: $('btn-go-generate'),

  // gate
  btnGoSettings: $('btn-go-settings'),
};

// ─── Init ─────────────────────────────────────────────────────────────────────

// Prevent duplicate listener registration across init() re-runs
let appEventsSetup = false;

async function init() {
  // Always set up gate button + storage listener, even when no key
  setupAlwaysOnListeners();

  const apiKey = await getApiKey();
  if (!apiKey) {
    show(els.noKey);
    hide(els.app);
    return;
  }
  hide(els.noKey);
  show(els.app);
  await loadScripts();
  bindEvents();
  switchTab('generate');
}

// Runs once — handles gate button and reacts to key being added from options page
let alwaysOnSetup = false;
function setupAlwaysOnListeners() {
  if (alwaysOnSetup) return;
  alwaysOnSetup = true;

  els.btnGoSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes.apiKey?.newValue && !els.noKey.hidden) {
      // Key was just saved in options page — re-init the sidepanel
      await init();
    }
    if (changes.scripts) {
      state.scripts = changes.scripts.newValue || [];
      updateBadge();
    }
  });
}

// ─── API Key check ────────────────────────────────────────────────────────────

async function getApiKey() {
  const result = await chrome.storage.local.get(['apiKey']);
  return result.apiKey || null;
}

async function getSettings() {
  const result = await chrome.storage.local.get(['apiKey', 'apiEndpoint', 'modelId']);
  return {
    apiKey: result.apiKey || '',
    endpoint: result.apiEndpoint || 'https://api.openai.com/v1/chat/completions',
    model: result.modelId || 'gpt-4o',
  };
}

// ─── Script loading ───────────────────────────────────────────────────────────

async function loadScripts() {
  const result = await chrome.storage.local.get('scripts');
  state.scripts = result.scripts || [];
  updateBadge();
}

function updateBadge() {
  const count = state.scripts.length;
  if (count > 0) {
    els.scriptsBadge.textContent = count;
    show(els.scriptsBadge);
  } else {
    hide(els.scriptsBadge);
  }
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function switchTab(tab) {
  state.currentTab = tab;

  els.tabGenerate.classList.toggle('active', tab === 'generate');
  els.tabScripts.classList.toggle('active', tab === 'scripts');

  if (tab === 'generate') {
    show(els.panelGenerate);
    hide(els.panelScripts);
  } else {
    hide(els.panelGenerate);
    show(els.panelScripts);
    renderScriptList();
  }
}

// ─── Generate phase switching ─────────────────────────────────────────────────

function switchGeneratePhase(phase) {
  state.generatePhase = phase;
  const phases = ['input', 'streaming', 'confirm', 'success', 'error'];
  for (const p of phases) {
    const el = $(`state-${p}`);
    if (el) el.hidden = (p !== phase);
  }
}

// ─── Event binding ────────────────────────────────────────────────────────────

function bindEvents() {
  if (appEventsSetup) return;
  appEventsSetup = true;

  els.tabGenerate.addEventListener('click', () => switchTab('generate'));
  els.tabScripts.addEventListener('click', () => switchTab('scripts'));
  $('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  // btnGoSettings is handled in setupAlwaysOnListeners()
  els.btnGoGenerate?.addEventListener('click', () => switchTab('generate'));

  els.btnGenerate.addEventListener('click', startGenerate);
  els.userInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) startGenerate();
  });

  els.btnCancel.addEventListener('click', cancelGenerate);
  els.btnRegenerate.addEventListener('click', () => {
    switchGeneratePhase('input');
    els.userInput.value = state.lastUserInput;
  });

  els.descriptionExpand.addEventListener('click', () => {
    els.descriptionBody.classList.add('expanded');
    hide(els.descriptionExpand);
  });

  els.codeToggle.addEventListener('click', () => {
    const open = !els.codeBlock.hidden;
    els.codeBlock.hidden = open;
    els.codeToggle.classList.toggle('open', !open);
    const label = els.codeToggle.querySelector('.code-toggle-label');
    label.textContent = open ? '查看代码' : '隐藏代码';
  });

  els.urlPattern.addEventListener('input', validatePattern);
  els.btnConfirm.addEventListener('click', confirmScript);
  els.btnRetry.addEventListener('click', startGenerate);
  els.btnErrorSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  // storage.onChanged is handled in setupAlwaysOnListeners()
}

// ─── Generate ─────────────────────────────────────────────────────────────────

async function startGenerate() {
  const input = els.userInput.value.trim();
  if (!input) return;

  state.lastUserInput = input;
  state.abortController = new AbortController();

  switchGeneratePhase('streaming');
  els.streamingCodePreview.textContent = '';
  hide(els.streamingPreview);

  try {
    const settings = await getSettings();
    if (!settings.apiKey) {
      showError('你的 API Key 好像不见了', true, false);
      return;
    }

    // Capture target tab NOW — before any async UI changes.
    // currentWindow:true is unreliable from a sidepanel page (sidepanel is not a tab),
    // so use lastFocusedWindow:true which reliably maps to the browser window.
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0] || null;
    state.targetTabId = tab?.id ?? null;
    const currentUrl = tab?.url || '';
    console.log('[monkey] startGenerate: targetTabId=', state.targetTabId, 'url=', currentUrl);

    // Extract DOM snapshot from the page before calling AI.
    // Without this the AI can only guess selectors — it will hallucinate class names and IDs.
    const domSnapshot = await extractDomSnapshot(state.targetTabId);

    const systemPrompt = buildSystemPrompt(currentUrl, domSnapshot);
    const userMsg = input;

    const { description, code, pattern } = await callAIStreaming(
      settings,
      systemPrompt,
      userMsg,
      state.abortController.signal
    );

    state.lastDescription = description;
    state.lastCode = code;
    state.lastPattern = pattern;

    // Check for existing scripts on same pattern
    await checkExistingScripts(pattern);

    // Populate confirm state
    populateConfirm(description, code, pattern);
    switchGeneratePhase('confirm');

  } catch (err) {
    if (err.name === 'AbortError') {
      switchGeneratePhase('input');
      return;
    }
    handleAIError(err);
  }
}

function cancelGenerate() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  switchGeneratePhase('input');
}

// ─── DOM snapshot ─────────────────────────────────────────────────────────────

// Runs in page MAIN world, returns a compact structural summary.
// Goal: give AI enough selector info without sending hundreds of KB of HTML.
function _domExtractor() {
  const MAX_ITEMS = 60;

  function attr(el, ...names) {
    for (const n of names) {
      const v = el.getAttribute(n);
      if (v) return `${n}="${v.slice(0, 80)}"`;
    }
    return '';
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    const extra = attr(el, 'name', 'type', 'placeholder', 'value', 'href', 'aria-label', 'data-key');
    const text = el.textContent?.trim().slice(0, 40) || '';
    return `<${tag}${id}${cls} ${extra}>${text ? `"${text}"` : ''}</${tag}>`;
  }

  const results = {
    title: document.title,
    url: location.href,
    metaDesc: document.querySelector('meta[name="description"]')?.content?.slice(0, 120) || '',
    interactive: [],   // inputs, buttons, selects, textareas
    landmarks: [],     // headings, nav, main, aside
    links: [],         // top anchor links
    ids: [],           // all elements with an id
  };

  // Interactive elements — highest selector reliability
  document.querySelectorAll('input, button, select, textarea, [role="button"], [onclick]')
    .forEach(el => {
      if (results.interactive.length < MAX_ITEMS) results.interactive.push(describe(el));
    });

  // Headings and landmarks
  document.querySelectorAll('h1,h2,h3,nav,main,header,footer,form')
    .forEach(el => {
      if (results.landmarks.length < 20) results.landmarks.push(describe(el));
    });

  // Top links
  document.querySelectorAll('a[href]')
    .forEach(el => {
      if (results.links.length < 20) results.links.push(describe(el));
    });

  // All IDs — extremely useful for precise selectors
  document.querySelectorAll('[id]')
    .forEach(el => {
      if (results.ids.length < MAX_ITEMS) results.ids.push(`#${el.id}(${el.tagName.toLowerCase()})`);
    });

  return results;
}

async function extractDomSnapshot(tabId) {
  if (!tabId) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: _domExtractor,
    });
    return result?.result ?? null;
  } catch (err) {
    console.warn('[monkey] DOM snapshot failed:', err.message);
    return null;
  }
}

function domSnapshotToText(snap) {
  if (!snap) return '（无法获取页面结构）';
  const lines = [
    `Page title: ${snap.title}`,
    snap.metaDesc ? `Meta description: ${snap.metaDesc}` : '',
    '',
    `IDs on page: ${snap.ids.join(', ') || 'none'}`,
    '',
    'Interactive elements (inputs / buttons / selects):',
    ...snap.interactive.map(s => '  ' + s),
    '',
    'Landmarks & headings:',
    ...snap.landmarks.map(s => '  ' + s),
    '',
    'Top links:',
    ...snap.links.slice(0, 12).map(s => '  ' + s),
  ];
  return lines.filter(l => l !== null).join('\n');
}

// ─── AI calling ───────────────────────────────────────────────────────────────

function buildSystemPrompt(currentUrl, domSnapshot) {
  const domSection = domSnapshotToText(domSnapshot);
  return `You are a userscript generator. The user describes what they want a webpage to do, and you generate a Tampermonkey-compatible userscript.

Current page URL: ${currentUrl}

─── LIVE PAGE STRUCTURE (extracted from the real DOM right now) ───
${domSection}
──────────────────────────────────────────────────────────────────

Use the IDs, class names, input names, and element structure above to write PRECISE selectors.
Do NOT invent selectors — use only what appears in the DOM structure above.

ALWAYS respond in this exact format — nothing before or after:
<DESCRIPTION>
（用中文简洁描述脚本做什么，1-3句话）
</DESCRIPTION>
<SCRIPT>
// ==UserScript==
// @name        脚本名称（中文）
// @match       ${currentUrl ? guessPattern(currentUrl) : 'https://example.com/*'}
// @run-at      document-end
// ==/UserScript==
(function() {
  'use strict';
  // vanilla JS only, no external dependencies
})();
</SCRIPT>

Rules:
- Use vanilla JS only — no jQuery, no external libraries
- The @match should cover the appropriate URL pattern for the user's need
- Keep code clean, well-commented in Chinese
- Use document-end unless CSS injection requires document-start
- Prefer IDs over class names for selectors; prefer specific selectors over generic ones`;
}

function guessPattern(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return 'https://example.com/*';
  }
}

async function callAIStreaming(settings, systemPrompt, userMsg, signal) {
  const response = await fetch(settings.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ],
      stream: true,
      temperature: 0.2,
    }),
    signal,
  });

  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  // Stream and accumulate
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let previewBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || '';
        accumulated += delta;
        previewBuffer += delta;

        // Show code preview once we're in the SCRIPT section
        if (accumulated.includes('<SCRIPT>')) {
          const scriptStart = accumulated.indexOf('<SCRIPT>') + 8;
          const previewText = accumulated.slice(scriptStart).replace(/```[a-z]*\n?/gi, '').trim();
          if (previewText) {
            show(els.streamingPreview);
            els.streamingCodePreview.textContent = previewText.slice(-600); // last 600 chars
          }
        }
      } catch {
        // Ignore malformed SSE lines
      }
    }
  }

  return parseAIResponse(accumulated);
}

function parseAIResponse(raw) {
  const descMatch = raw.match(/<DESCRIPTION>([\s\S]*?)<\/DESCRIPTION>/);
  const scriptMatch = raw.match(/<SCRIPT>([\s\S]*?)<\/SCRIPT>/);

  if (!descMatch && !scriptMatch) {
    const err = new Error('parse_none');
    err.parseError = 'none';
    throw err;
  }

  if (descMatch && !scriptMatch) {
    const err = new Error('parse_no_script');
    err.parseError = 'no_script';
    throw err;
  }

  let code = scriptMatch[1].trim();
  // Strip markdown code fences if present
  code = code.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  const description = descMatch ? descMatch[1].trim() : '';

  // Extract @match from code
  const matchLine = code.match(/@match\s+(.+)/);
  const pattern = matchLine ? matchLine[1].trim() : 'https://*/*';

  return { description, code, pattern };
}

function handleAIError(err) {
  if (err.parseError === 'none') {
    showError('生成结果不完整，请重试', false, false, true);
  } else if (err.parseError === 'no_script') {
    showError('脚本生成不完整，请重试', false, false, true);
  } else if (err.status === 401) {
    showError('你的 API Key 好像失效了', false, true, false);
  } else if (err.status === 429) {
    showError('请求太频繁，稍等一下再试', false, false, true);
  } else {
    showError('网络错误，请检查连接', false, false, true);
  }
}

function showError(msg, showSettings, showSettingsAlt, showRetry) {
  els.errorMessage.textContent = msg;
  els.btnRetry.hidden = !showRetry;
  els.btnErrorSettings.hidden = !(showSettings || showSettingsAlt);
  switchGeneratePhase('error');
}

// ─── Script execution ─────────────────────────────────────────────────────────

// Execute directly from sidepanel — sidepanel has scripting + host_permissions
// so it can call chrome.scripting.executeScript without routing through background SW.
async function executeScriptInTab(tabId, code) {
  console.log('[monkey] executeScriptInTab: tabId=', tabId, 'code length=', code.length);
  try {
    // chrome.scripting.executeScript with world:'MAIN' is explicitly exempt from page CSP.
    // The <script> tag approach IS subject to page CSP (inline-src) and fails on strict pages.
    // Indirect eval (0,eval) runs the code in global scope within MAIN world.
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (src) => (0, eval)(src), // eslint-disable-line no-eval
      args: [code],
    });
    console.log('[monkey] executeScriptInTab: OK');
  } catch (err) {
    console.error('[monkey] executeScriptInTab: failed:', err.message);
  }
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

async function checkExistingScripts(pattern) {
  const matching = state.scripts.filter(s => s.pattern === pattern);
  if (matching.length > 0) {
    els.existingNoticeText.textContent = `这个站点已有 ${matching.length} 个脚本`;
    show(els.existingNotice);
  } else {
    hide(els.existingNotice);
  }
}

function populateConfirm(description, code, pattern) {
  // Description — check if it needs expand button
  els.descriptionBody.textContent = description;
  els.descriptionBody.classList.remove('expanded');

  // Check if content overflows (> 120px)
  requestAnimationFrame(() => {
    const el = els.descriptionBody;
    el.style.maxHeight = 'none';
    const full = el.scrollHeight;
    el.style.maxHeight = '';
    if (full > 130) {
      show(els.descriptionExpand);
    } else {
      hide(els.descriptionExpand);
    }
  });

  // Code
  els.codeContent.textContent = code;
  els.codeBlock.hidden = true;
  els.codeToggle.classList.remove('open');
  els.codeToggle.querySelector('.code-toggle-label').textContent = '查看代码';

  // Pattern
  els.urlPattern.value = pattern;
  clearPatternError();
}

function validatePattern() {
  const val = els.urlPattern.value.trim();
  if (!val) {
    setPatternError('生效范围不能为空');
    return false;
  }
  if (!isValidPattern(val)) {
    setPatternError('格式不正确，例如：https://example.com/*');
    return false;
  }
  clearPatternError();
  return true;
}

function setPatternError(msg) {
  els.urlPattern.classList.add('invalid');
  els.patternError.textContent = msg;
  show(els.patternError);
}

function clearPatternError() {
  els.urlPattern.classList.remove('invalid');
  hide(els.patternError);
}

function isValidPattern(pattern) {
  if (pattern === '<all_urls>' || pattern === '*://*/*') return true;
  // Must match: scheme://host/path where scheme is http, https, or *
  return /^(\*|https?):\/\/[^/\s]+\/.*$/.test(pattern);
}

async function confirmScript() {
  if (!validatePattern()) return;

  const pattern = els.urlPattern.value.trim();
  const code = state.lastCode;
  const name = extractScriptName(code);

  const script = {
    id: crypto.randomUUID(),
    name,
    code,
    pattern,
    runAt: 'document-end',
    enabled: true,
    createdAt: Date.now(),
  };

  els.btnConfirm.disabled = true;

  // Save via background SW
  const saveResult = await chrome.runtime.sendMessage({
    type: 'SAVE_SCRIPT',
    payload: script
  });

  if (saveResult?.error) {
    els.btnConfirm.disabled = false;
    if (saveResult.error === 'quota_exceeded') {
      setPatternError('存储空间不足，无法保存脚本');
    } else {
      setPatternError('保存失败：' + saveResult.error);
    }
    return;
  }

  // Execute in current tab — use tabId captured at generation time
  const tabId = state.targetTabId;
  console.log('[monkey] confirmScript: executing in tabId=', tabId);
  if (tabId) {
    await executeScriptInTab(tabId, script.code);
  } else {
    console.warn('[monkey] confirmScript: no targetTabId, skipping execution');
  }

  els.btnConfirm.disabled = false;
  switchGeneratePhase('success');

  // Auto-reset to input after 2s
  setTimeout(() => {
    els.userInput.value = '';
    switchGeneratePhase('input');
  }, 2000);
}

function extractScriptName(code) {
  const match = code.match(/@name\s+(.+)/);
  return match ? match[1].trim() : '未命名脚本';
}

// ─── Script list rendering ────────────────────────────────────────────────────

function renderScriptList() {
  const scripts = state.scripts;

  if (scripts.length === 0) {
    show(els.scriptsEmpty);
    els.scriptList.innerHTML = '';
    return;
  }

  hide(els.scriptsEmpty);
  // Sort newest first in list
  const sorted = [...scripts].sort((a, b) => b.createdAt - a.createdAt);
  els.scriptList.innerHTML = '';

  for (const script of sorted) {
    els.scriptList.appendChild(renderScriptItem(script));
  }
}

function renderScriptItem(script) {
  const li = document.createElement('li');
  li.className = `script-item${script.enabled ? '' : ' disabled-item'}`;
  li.dataset.id = script.id;

  const isEditing = state.editingId === script.id;

  li.innerHTML = `
    <div class="script-item-header">
      <input type="checkbox" class="script-toggle" ${script.enabled ? 'checked' : ''} title="启用/禁用">
      <div class="script-meta">
        <p class="script-name">${escapeHtml(script.name)}</p>
        <p class="script-pattern">${escapeHtml(script.pattern)}</p>
      </div>
      <div class="script-item-actions">
        <button class="btn-icon btn-edit" title="编辑">✏️</button>
        <button class="btn-icon danger btn-delete" title="删除">🗑️</button>
      </div>
    </div>
    ${isEditing ? `
      <div class="script-edit-area">
        <textarea class="script-edit-textarea">${escapeHtml(script.code)}</textarea>
        <div class="script-edit-actions">
          <button class="btn btn-ghost btn-sm btn-edit-cancel">取消</button>
          <button class="btn btn-primary btn-sm btn-edit-save">保存</button>
        </div>
      </div>
    ` : ''}
  `;

  // Toggle enable/disable
  li.querySelector('.script-toggle').addEventListener('change', async e => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SCRIPT',
      payload: { id: script.id, enabled: e.target.checked }
    });
  });

  // Edit
  li.querySelector('.btn-edit').addEventListener('click', () => {
    state.editingId = state.editingId === script.id ? null : script.id;
    renderScriptList();
  });

  // Delete
  li.querySelector('.btn-delete').addEventListener('click', async () => {
    if (!confirm(`删除脚本"${script.name}"？`)) return;
    await chrome.runtime.sendMessage({ type: 'DELETE_SCRIPT', id: script.id });
    renderScriptList();
  });

  if (isEditing) {
    li.querySelector('.btn-edit-cancel').addEventListener('click', () => {
      state.editingId = null;
      renderScriptList();
    });

    li.querySelector('.btn-edit-save').addEventListener('click', async () => {
      const newCode = li.querySelector('.script-edit-textarea').value;
      const newName = extractScriptName(newCode) || script.name;
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SCRIPT',
        payload: { id: script.id, code: newCode, name: newName }
      });
      state.editingId = null;
      renderScriptList();
    });
  }

  return li;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
