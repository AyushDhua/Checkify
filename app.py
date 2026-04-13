"""
app.py
------
Flask application entry-point for the Checkify deceptive-pattern inference API.

Responsibilities
----------------
- Configure application-level logging
- Load ML artefacts at startup (fail-fast on missing files)
- Expose POST /predict and GET /health endpoints
- Validate all incoming requests and return standardised error envelopes
- Enable CORS for all origins (required by the browser extension)

No ML logic lives here; delegate everything to model_utils.
"""

import logging
import time
from typing import Tuple

from flask import Flask, jsonify, request, Response
from flask_cors import CORS

import config
import model_utils

# ---------------------------------------------------------------------------
# Logging – configure before the first log statement
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format=config.LOG_FORMAT,
    datefmt=config.LOG_DATE_FORMAT,
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})  # open CORS for all origins

# ---------------------------------------------------------------------------
# Load artefacts at import time so Gunicorn / uWSGI worker forks inherit them.
# The server will NOT start if any file is missing.
# ---------------------------------------------------------------------------
try:
    model_utils.load_artifacts()
except FileNotFoundError as exc:
    logger.critical("STARTUP FAILURE — missing model artefact:\n%s", exc)
    raise SystemExit(1) from exc
except Exception as exc:  # noqa: BLE001
    logger.critical("STARTUP FAILURE — could not load artefacts:\n%s", exc)
    raise SystemExit(1) from exc


# ---------------------------------------------------------------------------
# Helper: uniform error envelope
# ---------------------------------------------------------------------------

def _error(message: str, status: int) -> Tuple[Response, int]:
    """Return a JSON error response with a consistent shape."""
    logger.warning("Returning %d: %s", status, message)
    return jsonify({"error": message}), status


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> Tuple[Response, int]:
    """Liveness probe – always returns 200 when the server is up."""
    return jsonify({"status": "ok"}), 200


@app.route("/", methods=["GET", "POST"])
def index() -> Tuple[Response, int]:
    """
    GET  / → status probe (browser visits, extension preflight, curl checks)
    POST / → run inference

    POST request body (JSON):
        { "tokens": ["text one", "text two", …] }

    POST response body (JSON – strict contract):
        {
            "result": [
                [ { "pattern": "Scarcity", "confidence": 0.91 } ],
                [ { "pattern": "Urgency",  "confidence": 0.88 } ]
            ]
        }
    """
    # ---- GET: return a simple status envelope -----------------------------
    if request.method == "GET":
        return jsonify({"status": "ok", "message": "Checkify inference API is running."}), 200
    t_start = time.perf_counter()

    # ---- 1. Validate Content-Type / body presence -------------------------
    if not request.is_json:
        return _error("Request body must be JSON (Content-Type: application/json).", 400)

    body = request.get_json(silent=True)
    if body is None:
        return _error("Request body is missing or is not valid JSON.", 400)

    # ---- 2. Validate 'tokens' key -----------------------------------------
    if "tokens" not in body:
        return _error("Missing required field: 'tokens'.", 400)

    tokens = body["tokens"]

    if not isinstance(tokens, list):
        return _error("'tokens' must be a JSON array of strings.", 400)

    if len(tokens) == 0:
        return _error("'tokens' must not be empty.", 400)

    # Ensure every element is a string
    non_strings = [i for i, t in enumerate(tokens) if not isinstance(t, str)]
    if non_strings:
        return _error(
            f"All elements of 'tokens' must be strings. "
            f"Non-string values found at indices: {non_strings}.",
            400,
        )

    # ---- 3. Log request metadata ------------------------------------------
    logger.info(
        "POST / — received %d token(s) | body_size=%d bytes",
        len(tokens),
        request.content_length or 0,
    )

    # ---- 4. Run inference --------------------------------------------------
    try:
        response_payload = model_utils.build_response(tokens)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Internal error during inference: %s", exc)
        return _error("Internal server error during model inference.", 500)

    # ---- 5. Log processing time and return --------------------------------
    elapsed_ms = (time.perf_counter() - t_start) * 1000
    logger.info("POST / — completed in %.2f ms", elapsed_ms)

    return jsonify(response_payload), 200


# ---------------------------------------------------------------------------
# Global error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(exc) -> Tuple[Response, int]:
    return _error(f"Endpoint not found: {request.path}", 404)


@app.errorhandler(405)
def method_not_allowed(exc) -> Tuple[Response, int]:
    return _error(
        f"Method '{request.method}' is not allowed on {request.path}.", 405
    )


@app.errorhandler(500)
def internal_error(exc) -> Tuple[Response, int]:
    logger.exception("Unhandled exception: %s", exc)
    return _error("An unexpected internal server error occurred.", 500)


# ---------------------------------------------------------------------------
# Entry-point – development server only
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(
        host=config.HOST,
        port=config.PORT,
        debug=config.DEBUG,
    )
