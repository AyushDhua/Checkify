"use strict";

/**
 * content.js — DOM Inspector & Highlighter
 * ────────────────────────────────────────────────────────────────────────────
 * Responsibilities:
 *   1. Extract visible, meaningful text elements from the DOM
 *   2. Forward extracted tokens to background.js → Flask inference API
 *   3. Highlight elements whose text contains a dark pattern
 *   4. Show a floating tooltip on hover with pattern name + confidence %
 *
 * Message API (received from popup.js via chrome.tabs.sendMessage):
 *   { action: "scan"  } → run full scan, sendResponse with summary stats
 *   { action: "clear" } → remove all highlights, sendResponse { status: "cleared" }
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_TEXT_LEN        = 3;    // ignore text shorter than this
const MAX_TEXT_LEN        = 500;  // ignore text longer than this
const MAX_TOKENS          = 1500; // max elements sent per scan (increased to scan full pages)
const CONFIDENCE_THRESHOLD = 0.4; // lowered slightly to expose more valid dark patterns

/**
 * Full colour registry — used for tooltips and popup badges.
 * Covers every label the model may emit.
 */
const PATTERN_COLORS = {
  "Urgency":         "#f97316",
  "Scarcity":        "#ef4444",
  "Social Proof":    "#3b82f6",
  "Misdirection":    "#a855f7",
  "Hidden Costs":    "#eab308",
  "Trick Question":  "#92400e",
  "False Urgency":   "#f97316",
  "Confirmshaming":  "#14b8a6",
  "Forced Action":   "#d946ef",
  "Obstruction":     "#64748b",
  "Sneaking":        "#ec4899",
  "_default":        "#f59e0b",
};

/**
 * Only these labels are treated as dark patterns and will be highlighted.
 * Everything else the model returns is silently ignored.
 */
const DARK_PATTERNS = new Set([
  "Urgency",
  "Scarcity",
  "Social Proof",
  "Misdirection",
  "Hidden Costs",
  "Trick Question",
  "Forced Action",
  "Obstruction",
  "Sneaking",
  "False Urgency",
  "Confirmshaming"
]);

// ─── State ────────────────────────────────────────────────────────────────────

/** Parallel arrays: extractedEls[i] corresponds to token[i] sent to the API */
let extractedEls = [];

// ─── Tooltip (singleton, created once) ───────────────────────────────────────

const tooltip = document.createElement("div");
tooltip.className = "checkify-tooltip";
document.documentElement.appendChild(tooltip); // append to <html>, not <body>

function _showTooltip(target, pattern, confidence) {
  const color = PATTERN_COLORS[pattern] ?? PATTERN_COLORS["_default"];
  tooltip.style.setProperty("--ck-tip-color", color);
  tooltip.innerHTML =
    `<span>${pattern}</span><span class="ck-badge">${Math.round(confidence * 100)}%</span>`;

  const rect = target.getBoundingClientRect();
  // Place above the element; clamp to viewport edges
  const x = Math.max(6, Math.min(rect.left, window.innerWidth - 200));
  const y = rect.top - 38;
  tooltip.style.left = `${x}px`;
  tooltip.style.top  = `${Math.max(6, y)}px`;
  tooltip.classList.add("ck-visible");
}

function _hideTooltip() {
  tooltip.classList.remove("ck-visible");
}

// ─── Visibility check ────────────────────────────────────────────────────────

function _isVisible(el) {
  const s = window.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return (
    s.display     !== "none"    &&
    s.visibility  !== "hidden"  &&
    parseFloat(s.opacity) > 0   &&
    r.width  > 0               &&
    r.height > 0
  );
}

// ─── Text extraction ─────────────────────────────────────────────────────────

function _extractElements() {
  const nodes = document.querySelectorAll("*");
  const seen   = new Set();
  const items  = [];

  // Elements that indicate the parent is just a structural container, not a direct text block
  const STRUCTURAL_TAGS = new Set([
    "DIV", "P", "UL", "OL", "LI", "TABLE", "TR", "TD", "TH", 
    "SECTION", "ARTICLE", "HEADER", "FOOTER", "FORM", "MAIN", "ASIDE", "NAV"
  ]);

  for (const el of nodes) {
    if (items.length >= MAX_TOKENS) break;

    // Reject non-visible structural code tags
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "noscript", "meta", "title", "svg", "path", "img", "br", "hr"].includes(tag)) continue;

    // Leaf Block Heuristic: If this element contains any block-level structural children, 
    // it's a wrapper. We only want the lowest-level tight containers.
    let isWrapper = false;
    for (const child of el.children) {
      if (STRUCTURAL_TAGS.has(child.tagName)) {
        isWrapper = true;
        break;
      }
    }
    if (isWrapper) continue;

    // Now safe to use innerText because it's tightly bound to this leaf block
    const text = (el.innerText ?? el.textContent ?? "").trim();
    if (!text || text.length < MIN_TEXT_LEN || text.length > MAX_TEXT_LEN) continue;
    
    if (seen.has(text)) continue;
    if (!_isVisible(el)) continue;

    seen.add(text);
    items.push(el);
  }

  return items;
}

// ─── Highlighting ────────────────────────────────────────────────────────────

function _highlight(el, pattern, confidence) {
  const color = PATTERN_COLORS[pattern] ?? PATTERN_COLORS["_default"];
  el.classList.add("checkify-highlight");
  el.style.setProperty("--ck-color", color);

  el.addEventListener("mouseenter", () => _showTooltip(el, pattern, confidence));
  el.addEventListener("mouseleave", _hideTooltip);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

function _clearAll() {
  document.querySelectorAll(".checkify-highlight").forEach((el) => {
    el.classList.remove("checkify-highlight");
    el.style.removeProperty("--ck-color");
    // Cloning the node removes event listeners without breaking the DOM
    el.replaceWith(el.cloneNode(true));
  });
  _hideTooltip();
  extractedEls = [];
}

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  // ── SCAN ──────────────────────────────────────────────────────────────────
  if (message.action === "scan") {
    _clearAll();

    extractedEls = _extractElements();
    const tokens = extractedEls.map((el) =>
      (el.innerText ?? el.textContent ?? "").trim()
    );

    if (tokens.length === 0) {
      sendResponse({ status: "done", total: 0, detected: 0, patterns: {} });
      return true;
    }

    try {
      // Forward to service worker → Flask API
      chrome.runtime.sendMessage({ action: "predict", tokens }, (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          const msg = chrome.runtime.lastError?.message ?? res?.error ?? "Unknown API error";
          sendResponse({ status: "error", message: msg });
          return;
        }

        const result = res.data?.result;
        if (!Array.isArray(result)) {
          sendResponse({ status: "error", message: "Malformed API response: 'result' is not an array" });
          return;
        }

        let detected       = 0;
        const patternCounts = {};

        result.forEach((predictions, idx) => {
          // Each entry is a list; we use the top-1 prediction
          if (!Array.isArray(predictions) || predictions.length === 0) return;
          const { pattern, confidence } = predictions[0];
          // Skip if label is not one of the defined dark patterns
          if (!DARK_PATTERNS.has(pattern)) return;
          if (typeof confidence !== "number" || confidence < CONFIDENCE_THRESHOLD) return;
          if (!extractedEls[idx]) return;

          _highlight(extractedEls[idx], pattern, confidence);
          detected++;
          patternCounts[pattern] = (patternCounts[pattern] ?? 0) + 1;
        });

        sendResponse({ status: "done", total: tokens.length, detected, patterns: patternCounts });
      });
    } catch (err) {
      if (err.message && err.message.includes("Extension context invalidated")) {
        sendResponse({ status: "error", message: "Extension has been updated. Please refresh the page." });
      } else {
        sendResponse({ status: "error", message: err.message });
      }
    }

    return true; // keep message channel open for async sendResponse
  }

  // ── CLEAR ─────────────────────────────────────────────────────────────────
  if (message.action === "clear") {
    _clearAll();
    sendResponse({ status: "cleared" });
    return true;
  }
});

// ─── Floating Side Widget ─────────────────────────────────────────────────────
//
// Auto-injects a Honey-style tab on the right edge of e-commerce pages.
// Click the tab → panel slides in → auto-scans the page.
// ─────────────────────────────────────────────────────────────────────────────

const CK_ECOMMERCE_DOMAINS = [
  // India
  "amazon", "flipkart", "myntra", "meesho", "snapdeal", "ajio",
  "nykaa", "jiomart", "tatacliq", "croma", "reliancedigital",
  "bigbasket", "blinkit", "zepto", "lenskart", "indiamart",
  // Global
  "shopify", "etsy", "ebay", "walmart", "aliexpress", "shein",
  "target", "bestbuy", "rakuten", "wish", "zara", "hm.com",
  "nike", "adidas", "puma", "apple", "samsung",
];

function _isEcommerce() {
  const h = window.location.hostname.toLowerCase();
  return CK_ECOMMERCE_DOMAINS.some((d) => h.includes(d));
}

function _createWidget() {
  if (document.getElementById("ck-widget")) return;

  const w = document.createElement("div");
  w.id = "ck-widget";
  w.innerHTML = `
    <button id="ck-tab" title="Checkify – Dark Pattern Detector">
      <img src="${chrome.runtime.getURL('icons/icon.png')}" alt="Checkify" style="width:24px; height:24px; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.25));" />
    </button>

    <div id="ck-panel" class="ck-hidden">
      <div class="ck-panel-header">
        <div class="ck-panel-brand">
          <div class="ck-panel-logo">
            <img src="${chrome.runtime.getURL('icons/icon.png')}" alt="Checkify" style="width:100%; height:100%; object-fit:contain;" />
          </div>
          <div>
            <div class="ck-panel-name">Checkify</div>
            <div class="ck-panel-sub">Dark Pattern Detector</div>
          </div>
        </div>
        <button id="ck-close" title="Close">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6"  y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="ck-panel-body">
        <button id="ck-scan-btn">
          <span id="ck-btn-icon">⚡</span>
          <span id="ck-btn-label">Scan This Page</span>
        </button>

        <div id="ck-status"></div>

        <div id="ck-results" style="display:none">
          <div id="ck-stat-summary" class="ck-stat-summary">
            <div class="ck-stat-summary-content">
              <span id="ck-count" class="ck-count-num">0</span>
              <span class="ck-count-label">Dark Patterns Detected</span>
            </div>
            <svg class="ck-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
          <div id="ck-pattern-details" class="ck-pattern-details">
            <div id="ck-list" class="ck-list"></div>
          </div>
        </div>
      </div>

      <div class="ck-panel-footer">Powered by <strong>Checkify</strong></div>
    </div>
  `;

  document.body.appendChild(w);

  // — Tab click: toggle panel
  document.getElementById("ck-tab").addEventListener("click", () => {
    const panel  = document.getElementById("ck-panel");
    const isOpen = !panel.classList.contains("ck-hidden");
    if (isOpen) {
      panel.classList.add("ck-hidden");
    } else {
      panel.classList.remove("ck-hidden");
      if (!w._scanned) { w._scanned = true; _widgetScan(); }
    }
  });

  // — Close button
  document.getElementById("ck-close").addEventListener("click", () => {
    document.getElementById("ck-panel").classList.add("ck-hidden");
  });

  // — Scan button
  document.getElementById("ck-scan-btn").addEventListener("click", _widgetScan);

  // — Accordion toggle
  document.getElementById("ck-stat-summary").addEventListener("click", () => {
    document.getElementById("ck-stat-summary").classList.toggle("expanded");
    document.getElementById("ck-pattern-details").classList.toggle("expanded");
  });

  // — Draggable
  _makeDraggable(w);
}

// ── Drag logic (vertical, stays snapped to right edge) ───────────────────────
function _makeDraggable(widget) {
  const tab = document.getElementById("ck-tab");
  if (!tab) return;

  let startY   = 0;
  let startTop = 0;
  let isDragging = false;
  let didMove    = false;

  tab.style.cursor = "grab";

  tab.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();

    // Resolve the current rendered top (handles the CSS `top:50% + translateY(-50%)` initial state)
    startTop   = widget.getBoundingClientRect().top;
    startY     = e.clientY;
    isDragging = true;
    didMove    = false;

    // Switch to absolute-pixel positioning so JS can move it freely
    widget.style.top       = startTop + "px";
    widget.style.transform = "none";
    tab.style.cursor = "grabbing";

    window.addEventListener("mousemove", _onDragMove, { passive: true });
    window.addEventListener("mouseup",   _onDragUp);
  });

  function _onDragMove(e) {
    if (!isDragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 3) didMove = true;
    if (!didMove) return;

    const minTop = 10;
    const maxTop = window.innerHeight - tab.offsetHeight - 10;
    widget.style.top = Math.max(minTop, Math.min(startTop + dy, maxTop)) + "px";
  }

  function _onDragUp() {
    if (!isDragging) return;
    isDragging = false;
    tab.style.cursor = "grab";
    window.removeEventListener("mousemove", _onDragMove);
    window.removeEventListener("mouseup",   _onDragUp);
  }

  // Block the click event that fires after a drag so the panel doesn't toggle
  tab.addEventListener("click", (e) => {
    if (didMove) {
      e.stopImmediatePropagation();
      didMove = false;
    }
  }, true); // capture phase fires before the toggle listener
}

let _wScanning = false;

function _widgetScan() {
  if (_wScanning) return;
  _wScanning = true;

  _clearAll();

  const statusEl = document.getElementById("ck-status");
  const resultsEl = document.getElementById("ck-results");
  const scanBtn   = document.getElementById("ck-scan-btn");
  const btnIcon   = document.getElementById("ck-btn-icon");
  const btnLabel  = document.getElementById("ck-btn-label");

  if (!statusEl) { _wScanning = false; return; }

  // Vital check: If the extension was updated while this page was open,
  // the context is destroyed and any chrome.* API will crash the app.
  if (!chrome.runtime?.id) {
    _wScanning = false;
    statusEl.className = "ck-status-error";
    statusEl.textContent = "⚠ Extension updated. Please refresh the page.";
    return;
  }

  // Scanning state
  resultsEl.style.display = "none";
  statusEl.className = "ck-status-scanning";
  statusEl.textContent = "Analysing page elements…";
  scanBtn.disabled = true;
  btnIcon.style.animation = "ck-spin 0.75s linear infinite";
  btnLabel.textContent = "Scanning…";

  extractedEls = _extractElements();
  const tokens = extractedEls.map((el) => (el.innerText ?? el.textContent ?? "").trim());

  if (tokens.length === 0) {
    _wScanning = false;
    _widgetShowResults(0, {});
    return;
  }

  try {
    chrome.runtime.sendMessage({ action: "predict", tokens }, (res) => {
      _wScanning = false;
      scanBtn.disabled = false;
      btnIcon.style.animation = "";
      btnIcon.textContent = "↻";
      btnLabel.textContent = "Scan Again";

      if (chrome.runtime.lastError || !res?.success) {
        statusEl.className = "ck-status-error";
        statusEl.textContent = "⚠ Could not reach Checkify API. Is the server running?";
        return;
      }

      const result = res.data?.result;
      if (!Array.isArray(result)) {
        statusEl.className = "ck-status-error";
        statusEl.textContent = "⚠ Unexpected response from server.";
        return;
      }

      let detected = 0;
      const patternCounts = {};

      result.forEach((predictions, idx) => {
      if (!Array.isArray(predictions) || predictions.length === 0) return;
      const { pattern, confidence } = predictions[0];
      if (!DARK_PATTERNS.has(pattern)) return;
      if (typeof confidence !== "number" || confidence < CONFIDENCE_THRESHOLD) return;
      if (!extractedEls[idx]) return;
      _highlight(extractedEls[idx], pattern, confidence);
      detected++;
      patternCounts[pattern] = (patternCounts[pattern] ?? 0) + 1;
    });

      statusEl.className = "";
      statusEl.textContent = "";
      _widgetShowResults(detected, patternCounts);
    });
  } catch (err) {
    _wScanning = false;
    scanBtn.disabled = false;
    btnIcon.style.animation = "";
    btnIcon.textContent = "↻";
    btnLabel.textContent = "Scan Again";

    statusEl.className = "ck-status-error";
    if (err.message && err.message.includes("Extension context invalidated")) {
      statusEl.textContent = "⚠ Extension was updated under the hood. Please refresh this page to continue!";
    } else {
      statusEl.textContent = "⚠ Browser Error: " + err.message;
    }
  }
}

function _widgetShowResults(detected, patternCounts) {
  const countEl   = document.getElementById("ck-count");
  const listEl    = document.getElementById("ck-list");
  const resultsEl = document.getElementById("ck-results");
  const summaryEl = document.getElementById("ck-stat-summary");
  const detailsEl = document.getElementById("ck-pattern-details");
  if (!countEl || !listEl || !resultsEl) return;

  countEl.textContent = detected;
  countEl.className = detected > 0 ? "ck-count-num alert" : "ck-count-num ok";

  listEl.innerHTML = "";

  if (detected === 0) {
    summaryEl.style.display = "none";
    detailsEl.classList.add("expanded");
    listEl.innerHTML = `<div class="ck-clean">✓ No dark patterns found</div>`;
  } else {
    summaryEl.style.display = "flex";
    summaryEl.classList.remove("expanded");
    detailsEl.classList.remove("expanded");
    Object.entries(patternCounts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([pattern, count]) => {
        const color = PATTERN_COLORS[pattern] ?? "#f59e0b";
        const row = document.createElement("div");
        row.className = "ck-row";
        row.innerHTML = `
          <span class="ck-dot" style="background:${color}"></span>
          <span class="ck-pname">${pattern}</span>
          <span class="ck-pcount">${count}</span>
        `;
        listEl.appendChild(row);
      });
  }

  resultsEl.style.display = "block";
}

// ── Init ─────────────────────────────────────────────────────────────────────
if (_isEcommerce()) {
  // Wait for body to be ready
  if (document.body) {
    _createWidget();
  } else {
    document.addEventListener("DOMContentLoaded", _createWidget);
  }
}
