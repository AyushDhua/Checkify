"use strict";

/**
 * background.js — Service Worker
 * ────────────────────────────────────────────────────────────────────────────
 * Sole responsibility: relay { action: "predict", tokens: string[] } messages
 * from content.js to the Flask inference API and return the result.
 *
 * Using the service worker for fetch calls keeps the content script free of
 * network concerns and avoids CORS preflight issues in some browser configs.
 */

const API_URL = "http://127.0.0.1:8000/";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action !== "predict") return;

  fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens: message.tokens }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} – ${res.statusText}`);
      return res.json();
    })
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({ success: false, error: err.message }));

  return true; // keep the message channel open for async sendResponse
});
