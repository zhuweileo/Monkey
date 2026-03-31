// Background service worker — single writer for chrome.storage.local
// Handles: script storage, tab injection coordination, page navigation listening

chrome.runtime.onInstalled.addListener(({ reason }) => {
  // Open options page on first install for onboarding
  if (reason === 'install') {
    chrome.runtime.openOptionsPage();
  }

  // Direct sidepanel open on action click — no popup
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

// ─── Message router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_SCRIPTS':
      handleGetScripts(msg.url, sendResponse);
      return true; // async

    case 'SAVE_SCRIPT':
      handleSaveScript(msg.payload, sendResponse);
      return true;

    case 'UPDATE_SCRIPT':
      handleUpdateScript(msg.payload, sendResponse);
      return true;

    case 'DELETE_SCRIPT':
      handleDeleteScript(msg.id, sendResponse);
      return true;

    case 'EXECUTE_IMMEDIATE':
      // sidepanel asks us to execute a script in a specific tab right now
      handleExecuteImmediate(msg.tabId, msg.payload, sendResponse);
      return true;

    default:
      sendResponse({ error: 'unknown_message_type' });
  }
});

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function getScripts() {
  const result = await chrome.storage.local.get('scripts');
  return result.scripts || [];
}

async function saveScripts(scripts) {
  try {
    await chrome.storage.local.set({ scripts });
    return { ok: true };
  } catch (err) {
    console.error('[monkey] storage write failed:', err);
    if (err.message && err.message.includes('QUOTA_BYTES')) {
      return { error: 'quota_exceeded' };
    }
    return { error: err.message };
  }
}

// ─── Message handlers ─────────────────────────────────────────────────────────

async function handleGetScripts(url, sendResponse) {
  try {
    const all = await getScripts();
    const enabled = all.filter(s => s.enabled && matchesPattern(s.pattern, url));
    // Sort oldest first
    enabled.sort((a, b) => a.createdAt - b.createdAt);
    sendResponse({ type: 'SCRIPTS_LIST', payload: enabled });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleSaveScript(script, sendResponse) {
  try {
    const scripts = await getScripts();
    scripts.push(script);
    const result = await saveScripts(scripts);
    sendResponse(result);
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleUpdateScript(updated, sendResponse) {
  try {
    const scripts = await getScripts();
    const idx = scripts.findIndex(s => s.id === updated.id);
    if (idx === -1) {
      sendResponse({ error: 'not_found' });
      return;
    }
    scripts[idx] = { ...scripts[idx], ...updated };
    const result = await saveScripts(scripts);
    // Notify all content scripts that scripts changed (takes effect on next page load)
    broadcastScriptUpdated();
    sendResponse(result);
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleDeleteScript(id, sendResponse) {
  try {
    const scripts = await getScripts();
    const filtered = scripts.filter(s => s.id !== id);
    const result = await saveScripts(filtered);
    broadcastScriptUpdated();
    sendResponse(result);
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

async function handleExecuteImmediate(tabId, script, sendResponse) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (src) => (0, eval)(src), // eslint-disable-line no-eval
      args: [script.code],
    });
    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

function broadcastScriptUpdated() {
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'SCRIPT_UPDATED' }).catch(() => {});
      }
    }
  });
}

// ─── Page navigation: auto-inject on tab load ─────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.startsWith('http')) return;

  try {
    const all = await getScripts();
    const matching = all
      .filter(s => s.enabled && matchesPattern(s.pattern, tab.url))
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const script of matching) {
      // Use scripting.executeScript(world:'MAIN') — bypasses page CSP entirely.
      // The <script> tag approach fails on pages with strict inline-src CSP (e.g. baidu.com).
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (src) => (0, eval)(src), // eslint-disable-line no-eval
        args: [script.code],
      }).catch(err => console.warn('[monkey] auto-inject failed for tab', tabId, ':', err.message));
    }
  } catch (err) {
    console.error('[monkey] onUpdated error:', err);
  }
});

// ─── URL pattern matching (Tampermonkey @match glob syntax) ───────────────────
// Supported:
//   https://example.com/*
//   https://*.example.com/*
//   *://*/*   (all URLs)
//   <all_urls>

function matchesPattern(pattern, url) {
  if (!pattern || !url) return false;
  if (pattern === '<all_urls>' || pattern === '*://*/*') return true;

  try {
    // Convert glob pattern to regex
    const regex = globToRegex(pattern);
    return regex.test(url);
  } catch {
    return false;
  }
}

function globToRegex(pattern) {
  // Escape regex special chars except * and ?
  // Handle scheme: https://, http://, *://
  let p = pattern;

  // Split into scheme + rest
  const schemeMatch = p.match(/^([^:]+):\/\//);
  if (!schemeMatch) return new RegExp('(?!x)x'); // never matches

  const scheme = schemeMatch[1]; // e.g. "https", "*"
  const rest = p.slice(schemeMatch[0].length); // everything after "://"

  // Build regex for scheme
  const schemeRe = scheme === '*' ? '[^:]+' : escapeRegex(scheme);

  // Build regex for host + path
  // * in host matches any sequence except "." and "/"
  // * in path matches any sequence
  let restRe = '';
  let inHost = true;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '/' && inHost) {
      inHost = false;
      restRe += '\\/';
    } else if (ch === '*') {
      restRe += inHost ? '[^./]+' : '.*';
    } else if (ch === '?') {
      restRe += inHost ? '[^./]' : '.';
    } else {
      restRe += escapeRegex(ch);
    }
  }

  return new RegExp(`^${schemeRe}:\\/\\/${restRe}$`);
}

function escapeRegex(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}
