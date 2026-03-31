// Options page — API key configuration and connectivity test

const PROVIDER_DEFAULTS = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    modelHint: '推荐：gpt-4o / gpt-4o-mini',
  },
  claude: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-6',
    modelHint: '推荐：claude-sonnet-4-6 / claude-haiku-4-5-20251001',
  },
  custom: {
    endpoint: '',
    model: '',
    modelHint: '填写你的模型 ID',
  },
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const els = {
  providerPills: document.querySelectorAll('.pill[data-provider]'),
  apiKey: $('api-key'),
  toggleKeyVis: $('toggle-key-vis'),
  endpointGroup: $('endpoint-group'),
  apiEndpoint: $('api-endpoint'),
  modelId: $('model-id'),
  modelHint: $('model-hint'),
  explainerToggle: $('explainer-toggle'),
  explainerBody: $('explainer-body'),
  explainerLinks: document.querySelectorAll('.explainer-link'),
  btnTest: $('btn-test'),
  testResult: $('test-result'),
  btnSave: $('btn-save'),
  startSection: $('start-section'),
  btnStart: $('btn-start'),
};

let selectedProvider = 'openai';

// In-memory cache of per-provider field values, so switching tabs doesn't wipe user input.
// Populated from storage on load, then updated whenever the user switches away from a provider.
const savedFields = {
  openai: { endpoint: PROVIDER_DEFAULTS.openai.endpoint, model: PROVIDER_DEFAULTS.openai.model, apiKey: '' },
  claude:  { endpoint: PROVIDER_DEFAULTS.claude.endpoint,  model: PROVIDER_DEFAULTS.claude.model,  apiKey: '' },
  custom:  { endpoint: PROVIDER_DEFAULTS.custom.endpoint,  model: PROVIDER_DEFAULTS.custom.model,  apiKey: '' },
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadSettings();
  bindEvents();
}

async function loadSettings() {
  const result = await chrome.storage.local.get(['apiKey', 'apiEndpoint', 'modelId', 'provider']);
  const provider = result.provider || 'openai';

  // Seed the in-memory cache with whatever was last saved to storage.
  // This way switching back to a provider always restores the saved values.
  if (result.apiKey)      savedFields[provider].apiKey   = result.apiKey;
  if (result.apiEndpoint) savedFields[provider].endpoint = result.apiEndpoint;
  if (result.modelId)     savedFields[provider].model    = result.modelId;

  selectProvider(provider);

  // If we already have a key, show start section
  if (result.apiKey) show(els.startSection);
}

// ─── Provider selection ───────────────────────────────────────────────────────

function selectProvider(provider) {
  // Save current field values into cache before switching away
  if (selectedProvider) {
    savedFields[selectedProvider].apiKey   = els.apiKey.value;
    savedFields[selectedProvider].endpoint = els.apiEndpoint.value;
    savedFields[selectedProvider].model    = els.modelId.value;
  }

  selectedProvider = provider;
  const cached = savedFields[provider];
  const defaults = PROVIDER_DEFAULTS[provider];

  // Update pills
  els.providerPills.forEach(p => {
    p.classList.toggle('active', p.dataset.provider === provider);
  });

  // Show/hide endpoint field
  els.endpointGroup.hidden = provider !== 'custom';

  // Update model hint
  els.modelHint.textContent = defaults.modelHint;

  // Update explainer link visibility
  els.explainerLinks.forEach(l => {
    l.hidden = l.dataset.provider !== provider;
  });

  // Restore from cache (falls back to defaults if cache is empty)
  els.apiKey.value      = cached.apiKey   || '';
  els.apiEndpoint.value = cached.endpoint || defaults.endpoint;
  els.modelId.value     = cached.model    || defaults.model;
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Provider pills
  els.providerPills.forEach(pill => {
    pill.addEventListener('click', () => selectProvider(pill.dataset.provider));
  });

  // Key visibility toggle
  els.toggleKeyVis.addEventListener('click', () => {
    const isPassword = els.apiKey.type === 'password';
    els.apiKey.type = isPassword ? 'text' : 'password';
    els.toggleKeyVis.textContent = isPassword ? '🙈' : '👁';
  });

  // Explainer toggle
  els.explainerToggle.addEventListener('click', () => {
    const open = !els.explainerBody.hidden;
    els.explainerBody.hidden = open;
    els.explainerToggle.classList.toggle('open', !open);
  });

  // Test connection
  els.btnTest.addEventListener('click', testConnection);

  // Save
  els.btnSave.addEventListener('click', saveSettings);

  // Start using
  els.btnStart.addEventListener('click', () => {
    window.close();
  });
}

// ─── Test connection ──────────────────────────────────────────────────────────

async function testConnection() {
  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    showTestResult('error', '请先填入 API Key');
    return;
  }

  const endpoint = getEndpoint();
  const model = els.modelId.value.trim() || PROVIDER_DEFAULTS[selectedProvider].model;

  els.btnTest.disabled = true;
  showTestResult('testing', '连接测试中...');

  const start = Date.now();

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    // Anthropic API uses different auth headers
    if (selectedProvider === 'claude') {
      headers['anthropic-version'] = '2023-06-01';
      headers['x-api-key'] = apiKey;
      delete headers['Authorization'];
    }

    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildTestPayload(model)),
    }, 15000);

    const elapsed = Date.now() - start;

    if (response.ok) {
      showTestResult('success', `✓ 已连接 · ${model} · 延迟 ${elapsed}ms`);
      show(els.startSection);
    } else if (response.status === 401) {
      showTestResult('error', 'API Key 无效，请检查后重试');
    } else if (response.status === 429) {
      // 429 means key is valid, just rate limited
      showTestResult('success', `✓ 已连接 · ${model} · (请求频率限制，但 Key 有效)`);
      show(els.startSection);
    } else {
      const text = await response.text().catch(() => '');
      showTestResult('error', `连接失败 (HTTP ${response.status})${text ? ': ' + text.slice(0, 100) : ''}`);
    }
  } catch (err) {
    if (err.name === 'TimeoutError') {
      showTestResult('error', '连接超时，请检查网络或 endpoint 地址');
    } else {
      showTestResult('error', '网络错误：' + err.message);
    }
  } finally {
    els.btnTest.disabled = false;
  }
}

function buildTestPayload(model) {
  if (selectedProvider === 'claude') {
    return {
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    };
  }
  // OpenAI-compatible
  return {
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'hi' }],
  };
}

function getEndpoint() {
  if (selectedProvider === 'custom') {
    return els.apiEndpoint.value.trim() || PROVIDER_DEFAULTS.custom.endpoint;
  }
  return PROVIDER_DEFAULTS[selectedProvider].endpoint;
}

function showTestResult(type, msg) {
  els.testResult.hidden = false;
  els.testResult.className = `test-result ${type}`;
  els.testResult.textContent = msg;
}

async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const err = new Error('timeout');
    err.name = 'TimeoutError';
    controller.abort(err);
  }, timeout);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Save settings ────────────────────────────────────────────────────────────

async function saveSettings() {
  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    alert('请先填入 API Key');
    return;
  }

  const endpoint = getEndpoint();
  const model = els.modelId.value.trim() || PROVIDER_DEFAULTS[selectedProvider].model;

  els.btnSave.disabled = true;
  els.btnSave.textContent = '保存中...';

  try {
    await chrome.storage.local.set({
      apiKey,
      apiEndpoint: endpoint,
      modelId: model,
      provider: selectedProvider,
    });

    els.btnSave.textContent = '✓ 已保存';
    show(els.startSection);

    setTimeout(() => {
      els.btnSave.textContent = '保存设置';
      els.btnSave.disabled = false;
    }, 1500);
  } catch (err) {
    alert('保存失败：' + err.message);
    els.btnSave.textContent = '保存设置';
    els.btnSave.disabled = false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
