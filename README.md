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
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
```

### 2. Install dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Place model artefacts

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
```

### 5. Start the server

```bash
python app.py
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

**These must match the values used during model training.**

---

## Production Deployment (Gunicorn)

For production, never use the Flask dev server. Use Gunicorn:

```bash
pip install gunicorn
gunicorn -w 1 -b 127.0.0.1:8000 "app:app"
```

> Use `-w 1` (single worker) when the model is large, to avoid duplicating GPU memory across workers.

---

## CORS

CORS is enabled for all origins (`*`) so the browser extension can call the API directly. Restrict origins in production by editing:

```python
# app.py
CORS(app, resources={r"/*": {"origins": "https://your-extension-origin"}})
```
