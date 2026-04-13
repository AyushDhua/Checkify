# Checkify 🕵️‍♀️

Checkify is an ML-powered system designed to automatically detect and highlight **Deceptive Patterns** (also known as Dark Patterns) on e-commerce sites and websites. 

It consists of two main components running in tandem:
1. **Chrome Extension (Frontend)**: Scans web pages for textual elements, sends them for analysis, and highlights manipulative UI elements right in your browser.
2. **Flask Inference API (Backend)**: Uses a trained TensorFlow/Keras neural network to classify text snippets into categories like "Scarcity", "Urgency", etc., in real time.

---

## 🌟 How It Works

1. You visit a webpage.
2. The **Checkify Chrome Extension** extracts text elements from the site and sends them to the local Flask backend.
3. The **Flask API** tokenizes the text, passes it through the pre-trained ML model, and returns the confidence scores for any detected dark patterns.
4. The Extension paints a visible overlay on the screen exactly where the manipulative text is located, protecting you from deceptive designs!

---

## 📂 Project Structure

```text
Checkify/
│
├── Checkify/                     ← Chrome Extension files
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── content.css
│   ├── popup.html
│   └── icons/
│
├── model/                        ← Trained Keras Model & Encoders
│   ├── dark_pattern_model.h5
│   ├── tokenizer.pkl
│   └── label_encoder.pkl
│
├── app.py                        ← Flask API Entry-point
├── config.py                     ← Application Constants
├── model_utils.py                ← ML Inference logic
├── requirements.txt              ← Python Dependencies
└── README.md                     ← You are here!
```

---

## 🚀 Setup & Installation

To run this project, you need to start the Flask backend and load the unpacked extension into Chrome.

### Step 1: Start the Python Backend

We have set up a virtual environment using Python 3.11 with all dependencies installed.

```bash
# 1. Open your terminal in the root folder
cd /path/to/Checkify

# 2. Activate the virtual environment
source .venv/bin/activate

# 3. Start the Flask server
python app.py
```
*Expected output: The backend should say "All artefacts ready" and run on `http://127.0.0.1:8000`.*

### Step 2: Install the Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle **"Developer mode"** ON (top right corner).
3. Click the **"Load unpacked"** button (top left).
4. Select the inner `Checkify/Checkify` directory from this project.
5. The extension is now active and will communicate with your local Flask server!

---

## 🔌 API Reference (For Developers)

If you are modifying the backend or creating a different client, the API exposes the following:

**Endpoint:** `POST /`

**Payload:**
```json
{
  "tokens": ["limited time offer", "only 2 seats left"]
}
```

**Response (200 OK):**
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

---

## 🛠 Model Modifications

The `model/` directory ships with pre-trained weights (`.h5`) and standard tokenization (`.pkl`) artifacts. Ensure these files are always present before running the API.
If you retrain your model, simply drop the new `.h5` and `.pkl` files here and restart the backend. No code changes needed!
