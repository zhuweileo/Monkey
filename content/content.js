// Content script — minimal shim.
// All script injection is handled by background SW via chrome.scripting.executeScript(world:'MAIN'),
// which bypasses page CSP. The <script> tag approach used here is subject to page CSP and must NOT
// be used for code execution.
//
// This file's only remaining job: keep the message listener alive so background SW can
// detect that a content script is present (used for future messaging if needed).

(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((_msg, _sender, sendResponse) => {
    sendResponse({ ok: true });
  });

})();
