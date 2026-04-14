"use strict";

/**
 * popup.js
 * ────────────────────────────────────────────────────────────────────────────
 * Controls the extension popup UI.
 *
 * Flow:
 *   1. User clicks "Scan This Page"
 *   2. popup.js sends { action: "scan" } to the active tab's content script
 *   3. content.js responds with { status, total, detected, patterns }
 *   4. popup.js renders the result summary
 *
 * "Clear Highlights" sends { action: "clear" } to reset the DOM.
 */

// ─── Pattern colours (full registry, must mirror content.js) ──────────────────
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

// Only these are highlighted in the popup results panel
const DARK_PATTERNS = new Set([
  "Urgency", "Scarcity", "Social Proof",
  "Misdirection", "Hidden Costs", "Trick Question",
  "Forced Action", "Obstruction", "Sneaking",
  "False Urgency", "Confirmshaming"
]);

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const scanBtn      = document.getElementById("scanBtn");
const btnIcon      = document.getElementById("btnIcon");
const btnLabel     = document.getElementById("btnLabel");
const statusBar    = document.getElementById("statusBar");
const statusIcon   = document.getElementById("statusIcon");
const statusText   = document.getElementById("statusText");
const resultsPanel = document.getElementById("resultsPanel");
const patternList    = document.getElementById("patternList");
const statSummary    = document.getElementById("statSummary");
const patternDetails = document.getElementById("patternDetails");
const clearBtn       = document.getElementById("clearBtn");

statSummary.addEventListener("click", () => {
  statSummary.classList.toggle("expanded");
  patternDetails.classList.toggle("expanded");
});

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setScanning() {
  scanBtn.disabled = true;
  btnIcon.innerHTML = `<span class="spin">⧘</span>`;
  btnLabel.textContent = "Scanning…";
  _showStatus("scanning", "🔍", "Analysing page elements…");
  resultsPanel.classList.remove("visible");
}

function setIdle(label = "Scan This Page") {
  scanBtn.disabled = false;
  btnIcon.textContent = "⚡";
  btnLabel.textContent = label;
}

function _showStatus(type, icon, text) {
  statusBar.className = `status-bar visible ${type}`;
  statusIcon.textContent = icon;
  statusText.textContent = text;
}

function hideStatus() {
  statusBar.classList.remove("visible");
}

function renderResults(data) {
  const { total = 0, detected = 0, patterns = {} } = data;

  const numEl = document.getElementById("countNum");
  numEl.textContent = detected;
  numEl.className   = `stat-val ${detected === 0 ? "ok" : "alert"}`;

  patternList.innerHTML = "";

  if (detected === 0) {
    statSummary.style.display = "none";
    patternDetails.classList.add("expanded"); // Force show the clean state
    patternList.innerHTML = `
      <div class="clean-state">
        <div class="clean-icon">✅</div>
        <div class="clean-title">All Clear</div>
        <div class="clean-sub">No dark patterns detected on this page.</div>
      </div>`;
  } else {
    statSummary.style.display = "flex";
    statSummary.classList.remove("expanded");
    patternDetails.classList.remove("expanded");

    Object.entries(patterns)
      .sort(([, a], [, b]) => b - a)
      .forEach(([pattern, count]) => {
        const color = PATTERN_COLORS[pattern] ?? PATTERN_COLORS["_default"];
        const row = document.createElement("div");
        row.className = "pattern-row";
        row.innerHTML = `
          <span class="p-swatch" style="background:${color}"></span>
          <span class="p-name">${pattern}</span>
          <span class="p-count">${count}</span>
        `;
        patternList.appendChild(row);
      });
  }

  resultsPanel.classList.add("visible");
}

// ─── Active tab helper ────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

// ─── Event: Scan ─────────────────────────────────────────────────────────────

scanBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    _showStatus("error", "✕", "Cannot access the current tab.");
    return;
  }

  setScanning();

  // Helper: inject content script if not already present, then run the scan
  async function runScan() {
    chrome.tabs.sendMessage(tab.id, { action: "scan" }, async (response) => {
      if (chrome.runtime.lastError) {
        // Content script not yet injected — inject it now and retry once
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ["content.css"],
          });
          // Small delay to let the script initialise
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: "scan" }, (retryResponse) => {
              if (chrome.runtime.lastError || !retryResponse) {
                setIdle();
                _showStatus("error", "✕", "Cannot scan this page. Try a regular website.");
                return;
              }
              _handleScanResponse(retryResponse);
            });
          }, 300);
        } catch (_) {
          setIdle();
          _showStatus("error", "✕", "Cannot scan this page. Try a regular website.");
        }
        return;
      }
      _handleScanResponse(response);
    });
  }

  function _handleScanResponse(response) {
    setIdle("Scan Again");

    if (response?.status === "error") {
      _showStatus("error", "✕", `Error: ${response.message}`);
      return;
    }

    if (response?.detected === 0) {
      _showStatus("clean", "✓", `Scanned ${response.total} elements — page looks clean.`);
      renderResults(response);
    } else {
      hideStatus();
      renderResults(response);
    }

    clearBtn.disabled = false;
  }

  runScan();
});

// ─── Event: Clear ────────────────────────────────────────────────────────────

clearBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { action: "clear" }, () => {
    resultsPanel.classList.remove("visible");
    hideStatus();
    setIdle("Scan This Page");
    clearBtn.disabled = true;
  });
});
