# Checkify — Deceptive Pattern Inference API

A production-quality Flask backend for serving a trained TensorFlow/Keras model that detects deceptive patterns (dark patterns) in text.

---

## Project Structure

```
Checkify/
│
├── model/                        ← DROP YOUR MODEL FILES HERE (see below)
│   ├── dark_pattern_model.h5
│   ├── tokenizer.pkl
│   └── label_encoder.pkl
│
├── app.py                        ← Flask app + routing + validation
├── model_utils.py                ← ML loading, preprocessing, inference
├── config.py                     ← All constants (paths, hyperparameters)
├── requirements.txt
└── README.md
```

> **The `model/` folder ships empty.** You must manually place the three artefact files inside it before starting the server. The server **will not start** without them.

---

## Required Model Files

| File | Description |
|------|-------------|
| `model/deceptive_pattern_model.h5` | Trained Keras model |
| `model/tokenizer.pkl` | Fitted `Tokenizer` instance (pickle) |
| `model/label_encoder.pkl` | Fitted `LabelEncoder` instance (pickle) |

---

## Setup — Step by Step

### 1. Create a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate          # Windows: .venv\Scripts\activate
```

### 2. Install dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Check model artefacts

Copy your trained files into the `model/` directory:

```
model/deceptive_pattern_model.h5
model/tokenizer.pkl
model/label_encoder.pkl
```

### 4. (Optional) Adjust `config.py`

If your model was trained with a different sequence length, edit:

```python
# config.py
MAX_SEQUENCE_LEN: int = 100   # ← change to match training
##100 is fine.
```

### 5. Start the server

```bash
python3 app.py
```

Expected startup output:
```
2026-01-01T12:00:00  [INFO]  __main__ — Loading model artefacts …
2026-01-01T12:00:02  [INFO]  __main__ — Keras model loaded from model/deceptive_pattern_model.h5
2026-01-01T12:00:02  [INFO]  __main__ — Loaded tokenizer from model/tokenizer.pkl
2026-01-01T12:00:02  [INFO]  __main__ — Loaded label_encoder from model/label_encoder.pkl
2026-01-01T12:00:02  [INFO]  __main__ — All artefacts ready in 1.847 s
 * Running on http://127.0.0.1:8000
```

---

## API Reference

### `GET /health`

Liveness probe.

```bash
curl http://127.0.0.1:8000/health
```

```json
{ "status": "ok" }
```

---

### `POST /predict`

Run inference on one or more text strings.

**Request**

```http
POST /predict
Content-Type: application/json

{
  "tokens": ["limited time offer", "only 2 seats left"]
}
```

**Response (200)**

```json
{
  "result": [
    [
      { "pattern": "Scarcity", "confidence": 0.91 }
    ],
    [
      { "pattern": "Urgency", "confidence": 0.88 }
    ]
  ]
}
```

**Error Responses**

| Status | Cause |
|--------|-------|
| 400 | Missing/invalid JSON body |
| 400 | Missing `tokens` key |
| 400 | `tokens` is not an array |
| 400 | Empty `tokens` array |
| 400 | Non-string element inside `tokens` |
| 500 | Internal model inference error |

All errors follow the shape:
```json
{ "error": "Human-readable description." }
```

---

## Preprocessing Configuration

Defined in `config.py`:

| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_SEQUENCE_LEN` | `100` | Pad/truncate to this many tokens |
| `PADDING` | `"post"` | Where to pad short sequences |
| `TRUNCATING` | `"post"` | Where to cut long sequences |
| `BATCH_SIZE` | `32` | Sequences per `model.predict()` call |

---

## CORS

CORS is enabled for all origins (`*`) so the browser extension can call the API directly. Restrict origins in production by editing:

```python
# app.py
CORS(app, resources={r"/*": {"origins": "https://your-extension-origin"}})
```

---

## Loading Checkify as a Chrome Extension

Checkify ships with a browser extension that sends selected text to the `/predict` endpoint and displays detected dark patterns inline. Follow the steps below to sideload it in developer mode — **no Chrome Web Store listing required**.

> **Prerequisites:** The Flask server must be running on `http://127.0.0.1:8000` before you activate the extension.

---

### Step 1 — Make sure the Flask server is running

```bash
source venv/bin/activate          # Windows: .venv\Scripts\activate
python app.py
```

You should see `Running on http://127.0.0.1:8000` in the terminal. Keep this terminal open.

---

### Step 2 — Open the Extensions management page

| Browser | How to open |
|---------|-------------|
| **Google Chrome** | Navigate to `chrome://extensions` in the address bar |
| **Microsoft Edge** | Navigate to `edge://extensions` |
| **Brave** | Navigate to `brave://extensions` |
| **Arc** | Open Settings → Extensions → Manage Extensions |
| **Firefox** | Navigate to `about:debugging#/runtime/this-firefox` (see Firefox note below) |

---

### Step 3 — Enable Developer Mode

In the top-right corner of the Extensions page, toggle **Developer mode** ON.

```
┌─────────────────────────────────────────┐
│  Extensions              Developer mode ●│
└─────────────────────────────────────────┘
```

Once enabled, three new buttons appear: **Load unpacked**, **Pack extension**, and **Update**.

---

### Step 4 — Load the unpacked extension

1. Click **Load unpacked**.
2. In the file-picker dialog, navigate to the root of this repository (`Checkify/`).
3. Select the `extension/` sub-folder (the one that contains `manifest.json`).
4. Click **Select Folder** (macOS/Linux) or **Open** (Windows).

The extension card should now appear in the list with the Checkify icon.

---

### Step 5 — Pin the extension (optional but recommended)

1. Click the **puzzle-piece icon** (🧩) in the Chrome toolbar.
2. Find **Checkify** in the dropdown.
3. Click the **pin icon** 📌 next to it so the Checkify icon is always visible in the toolbar.

---

### Step 6 — Using the extension

1. Visit any e-commerce website(Amazon, Flipkart, Myntra, Meesho, Nykaa, Snapdeal, eBay, Etc.).
2. Click the **Checkify icon** in the toolbar (or right-click → *Checkify: Analyse selection*).
3. A popup will appear showing each detected dark-pattern label and its confidence score, e.g.:

```
Scarcity   ████████░░  91 %
Urgency    ███████░░░  88 %
```

---

### Reloading after code changes

If you edit any extension source file (e.g. `content.js`, `popup.html`), reload the extension so Chrome picks up the changes:

1. Go back to `chrome://extensions`.
2. Find the Checkify card.
3. Click the **circular-arrow (↺) reload** button on the card.

Alternatively, press the keyboard shortcut shown next to the extension in the management page.

---

### Firefox — Load Temporary Add-on

Firefox does not support **Load unpacked** the same way. Instead:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Navigate to `extension/` and select the `manifest.json` file directly.
4. The extension is active until Firefox is restarted. Repeat this step each session.

> **Note:** For persistent installation on Firefox, the extension must be signed by Mozilla or installed via Firefox Developer Edition / Nightly with `xpinstall.signatures.required` set to `false` in `about:config`.

---

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Extension shows "Could not connect" | Flask server is not running | Run `python3 app.py` and keep the terminal open |
| CORS error in browser console | Server origin whitelist mismatch | Ensure `CORS(app, resources={r"/*": {"origins": "*"}})` is set in `app.py` |
| "Manifest file is missing or unreadable" | Wrong folder selected | Re-do Step 4 and select the **`extension/`** folder, not the repo root |
| Predictions always return empty | `tokens` payload is empty | Make sure you have text selected before clicking the extension icon |
| Extension disappears after browser restart | Loaded in temporary mode (Firefox) | Reload via `about:debugging` or install permanently |
