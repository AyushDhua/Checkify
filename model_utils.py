"""
model_utils.py
--------------
Encapsulates every ML concern:
  - Loading model artefacts from disk (once, at startup)
  - Text preprocessing (tokenize → pad)
  - Batch inference
  - Response envelope construction

Nothing Flask-specific lives here; the module is independently testable.
"""

import logging
import os
import pickle
import time
from typing import Any, Dict, List

import numpy as np
from keras.preprocessing.sequence import pad_sequences  # type: ignore
from tensorflow import keras  # type: ignore

import config

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level singletons – populated once by load_artifacts()
# ---------------------------------------------------------------------------
_model: Any = None
_tokenizer: Any = None
_label_encoder: Any = None


# ---------------------------------------------------------------------------
# Artifact loading
# ---------------------------------------------------------------------------

def _load_pickle(path: str, name: str) -> Any:
    """Load a pickle file, raising a descriptive RuntimeError on failure."""
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"[{name}] Expected file not found at: {path}\n"
            "Place the file in the model/ directory and restart the server."
        )
    with open(path, "rb") as fh:
        obj = pickle.load(fh)
    logger.info("Loaded %s from %s", name, path)
    return obj


def load_artifacts() -> None:
    """
    Load all model artefacts into module-level singletons.

    Must be called ONCE before the Flask app starts accepting requests.
    Raises immediately with a clear message if any file is missing or corrupt.
    """
    global _model, _tokenizer, _label_encoder

    logger.info("Loading model artefacts …")
    t0 = time.perf_counter()

    # Keras model
    if not os.path.isfile(config.MODEL_PATH):
        raise FileNotFoundError(
            f"[model] Expected file not found at: {config.MODEL_PATH}\n"
            "Place the .h5 file in the model/ directory and restart the server."
        )
    _model = keras.models.load_model(config.MODEL_PATH)
    logger.info("Keras model loaded from %s", config.MODEL_PATH)

    # Tokenizer
    _tokenizer = _load_pickle(config.TOKENIZER_PATH, "tokenizer")

    # Label encoder
    _label_encoder = _load_pickle(config.LABEL_ENCODER_PATH, "label_encoder")

    elapsed = time.perf_counter() - t0
    logger.info("All artefacts ready in %.3f s", elapsed)


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

def preprocess(texts: List[str]) -> np.ndarray:
    """
    Convert a list of raw strings into a padded integer matrix.

    Steps
    -----
    1. texts_to_sequences  – map tokens to vocabulary indices
    2. pad_sequences       – uniform length, configured in config.py

    Returns
    -------
    np.ndarray of shape (len(texts), MAX_SEQUENCE_LEN)
    """
    if _tokenizer is None:
        raise RuntimeError("Tokenizer not loaded. Call load_artifacts() first.")

    sequences = _tokenizer.texts_to_sequences(texts)
    padded = pad_sequences(
        sequences,
        maxlen=config.MAX_SEQUENCE_LEN,
        padding=config.PADDING,
        truncating=config.TRUNCATING,
    )
    return padded  # shape: (N, MAX_SEQUENCE_LEN)


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def predict(texts: List[str]) -> List[Dict[str, Any]]:
    """
    Run batch inference for a list of text strings.

    Parameters
    ----------
    texts : list of str
        Raw input strings exactly as received from the API.

    Returns
    -------
    List of dicts, one per input:
        {
            "pattern":    str,   # decoded class label
            "confidence": float  # probability for the predicted class
        }

    Raises
    ------
    RuntimeError  if artefacts are not loaded.
    Exception     propagates from Keras/NumPy on unexpected input shapes.
    """
    if _model is None or _label_encoder is None:
        raise RuntimeError("Model artefacts not loaded. Call load_artifacts() first.")

    # 1. Preprocess
    x = preprocess(texts)  # (N, MAX_SEQUENCE_LEN)

    # 2. Inference – model.predict handles batching internally
    probabilities = _model.predict(x, batch_size=config.BATCH_SIZE, verbose=0)
    # shape: (N, num_classes)

    # 3. Decode predictions
    predicted_indices = np.argmax(probabilities, axis=1)          # (N,)
    predicted_labels  = _label_encoder.inverse_transform(predicted_indices)
    confidence_scores = probabilities[
        np.arange(len(probabilities)), predicted_indices
    ]  # (N,)

    results = [
        {
            "pattern":    str(label),
            "confidence": round(float(score), 4),
        }
        for label, score in zip(predicted_labels, confidence_scores)
    ]
    return results


# ---------------------------------------------------------------------------
# Response builder
# ---------------------------------------------------------------------------

def build_response(texts: List[str]) -> Dict[str, Any]:
    """
    Orchestrate preprocessing + inference and wrap output in the contract
    envelope.

    The API contract mandates:
        {
            "result": [
                [ { "pattern": "...", "confidence": 0.xx } ],
                ...
            ]
        }

    Each inner list corresponds to one input string.  Currently the model
    yields a single top-1 prediction per input; extend this function if
    you later want top-k predictions per input.

    Parameters
    ----------
    texts : list of str

    Returns
    -------
    dict matching the strict API contract
    """
    predictions = predict(texts)

    # Wrap each prediction in its own list (contract: list of lists)
    result = [[pred] for pred in predictions]

    return {"result": result}
