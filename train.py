import argparse
import os
import pickle
import numpy as np
import csv
import tensorflow as tf
from tensorflow import keras

import config

def main():
    parser = argparse.ArgumentParser(description="Fine-tune Checkify Dark Pattern Model")
    parser.add_argument("data_file", help="Path to CSV containing new training data")
    parser.add_argument("--text_col", default="Pattern String", help="Name of column with text")
    parser.add_argument("--label_col", default="Pattern Category", help="Name of column with labels")
    parser.add_argument("--epochs", type=int, default=10, help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=32, help="Batch size")
    args = parser.parse_args()

    print(f"\n[1] Loading existing model from {config.MODEL_PATH}...")
    model = keras.models.load_model(config.MODEL_PATH)
    
    with open(config.TOKENIZER_PATH, "rb") as f:
        tokenizer = pickle.load(f)
        
    with open(config.LABEL_ENCODER_PATH, "rb") as f:
        label_encoder = pickle.load(f)

    # Recompile with a low learning rate to fine-tune without unlearning everything else
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=5e-5), 
        loss="sparse_categorical_crossentropy", 
        metrics=["accuracy"]
    )

    print(f"\n[2] Loading data from {args.data_file}...")
    try:
        with open(args.data_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            columns = reader.fieldnames or []
            rows = list(reader)
    except Exception as e:
        print(f"Failed to read CSV: {e}")
        return

    # Try to gracefully handle incorrect column names
    if args.text_col not in columns:
        if "text" in columns: args.text_col = "text"
        else:
            print(f"Missing text column: {args.text_col}. Available columns are: {columns}")
            return
            
    if args.label_col not in columns:
        if "label" in columns: args.label_col = "label"
        elif "Pattern Type" in columns: args.label_col = "Pattern Type"
        else:
            print(f"Missing label column: {args.label_col}. Available columns are: {columns}")
            return

    # Extract text and labels, ignoring empty rows
    texts = []
    raw_labels = []
    for row in rows:
        t = (row.get(args.text_col) or "").strip()
        l = (row.get(args.label_col) or "").strip()
        if t and l:
            texts.append(t)
            raw_labels.append(l)

    # The existing model was trained on a specific set of Dark Pattern labels.
    # We must only train on rows that map to these known categories.
    valid_classes = set(label_encoder.classes_)
    
    filtered_texts = []
    filtered_labels = []
    
    for t, l in zip(texts, raw_labels):
        # We also support mapping some slight variations if needed
        l_norm = l.strip()
        if l_norm in valid_classes:
            filtered_texts.append(t)
            filtered_labels.append(l_norm)
            
    print(f"Found {len(filtered_texts)} strictly valid training examples (discarded {(len(texts) - len(filtered_texts))} with unknown labels).")
    
    if len(filtered_texts) == 0:
        print(f"\nERROR: No valid labels found! The model specifically supports these Exact Categories:\n{valid_classes}")
        return

    # Convert strings to integer labels
    labels = label_encoder.transform(filtered_labels)

    # Tokenize the strings and Pad them
    seqs = tokenizer.texts_to_sequences(filtered_texts)
    from keras.preprocessing.sequence import pad_sequences
    X = pad_sequences(
        seqs, 
        maxlen=config.MAX_SEQUENCE_LEN, 
        padding=config.PADDING, 
        truncating=config.TRUNCATING
    )
    y = np.array(labels)

    print(f"\n[3] Evaluating CURRENT performance on the new data before fine-tuning...")
    loss, acc = model.evaluate(X, y, verbose=0)
    print(f"Current Accuracy: {acc*100:.2f}%")

    print(f"\n[4] Fine-tuning the model for {args.epochs} epochs...")
    model.fit(X, y, epochs=args.epochs, batch_size=args.batch_size, validation_split=0.1)

    print(f"\n[5] Evaluating NEW performance AFTER fine-tuning...")
    post_loss, post_acc = model.evaluate(X, y, verbose=0)
    
    improvement = post_acc - acc
    print(f"New Accuracy: {post_acc*100:.2f}% (Improvement: {improvement*100:+.2f}%)")

    # Save to disk
    print(f"\n[6] Overwriting old model and saving to {config.MODEL_PATH}...")
    model.save(config.MODEL_PATH)
    
    print("\n✅ Done! **IMPORTANT: You MUST restart your Flask server for it to load the latest brain!**")

if __name__ == "__main__":
    main()
