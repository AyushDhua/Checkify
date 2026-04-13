"""
config.py
---------
Central configuration for the Checkify Flask inference server.
All tunable constants live here so downstream modules never have
hard-coded magic values.
"""

import os

# ---------------------------------------------------------------------------
# Project base
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "model")

# ---------------------------------------------------------------------------
# Model artefact paths  (files are placed manually by the operator)
# ---------------------------------------------------------------------------
MODEL_PATH         = os.path.join(MODEL_DIR, "dark_pattern_model.h5")
TOKENIZER_PATH     = os.path.join(MODEL_DIR, "tokenizer.pkl")
LABEL_ENCODER_PATH = os.path.join(MODEL_DIR, "label_encoder.pkl")

# ---------------------------------------------------------------------------
# Preprocessing hyperparameters
# Must match the values used during training.
# ---------------------------------------------------------------------------
MAX_SEQUENCE_LEN: int = 100   # pad / truncate every sequence to this length
PADDING: str = "post"         # 'pre' | 'post'
TRUNCATING: str = "post"      # 'pre' | 'post'

# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------
BATCH_SIZE: int = 32          # number of sequences forwarded to model at once

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
HOST: str = "127.0.0.1"
PORT: int = 8000
DEBUG: bool = False           # never enable in production

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL: str = "INFO"
LOG_FORMAT: str = "%(asctime)s  [%(levelname)s]  %(name)s — %(message)s"
LOG_DATE_FORMAT: str = "%Y-%m-%dT%H:%M:%S"
