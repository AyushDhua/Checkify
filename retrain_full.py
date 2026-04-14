import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import csv
import re
import numpy as np
import pickle
from tensorflow import keras
from tensorflow.keras.preprocessing.text import Tokenizer
from tensorflow.keras.preprocessing.sequence import pad_sequences
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Embedding, LSTM, Dense, Dropout
from sklearn.preprocessing import LabelEncoder

def load_data():
    texts = []
    labels = []

    # 1. Load patterns (Dark patterns)
    with open('training_data/patterns.csv', 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.reader(f)
        header = next(reader, None)
        for row in reader:
            if not row or len(row) < 4: continue
            
            # The CSV is mangled. Pattern String is usually first.
            text = row[0].strip()
            
            # Searching for Pattern Category (usually Urgency, Scarcity, etc)
            cat = None
            for col in row:
                col_n = col.strip()
                if col_n in ["Urgency", "Scarcity", "Social Proof", "Misdirection", "Hidden Costs", "Trick Question", "Forced Action", "Obstruction", "Sneaking", "False Urgency", "Confirmshaming"]:
                    cat = col_n
                    break
            
            if text and cat:
                texts.append(text)
                labels.append(cat)

    # 2. Add specific Amazon keywords that were missed as dark patterns
    extra_patterns = [
        ("Limited time deal", "Scarcity"),
        ("Limited time offer", "Scarcity"),
        ("Get GST invoice and save up to 18%", "Misdirection"),
        ("Upto ₹89.00 cashback as Amazon", "Misdirection"),
        ("-70% ₹2,999", "Urgency"),
        ("Only 3 left in stock", "Scarcity"),
        ("Or fastest delivery Tomorrow", "Urgency"),
        ("Order within 2 hrs 23 mins", "Urgency"),
        ("Or fastest delivery", "Urgency"),
        ("Bank Offer", "Misdirection"),
        ("Partner Offers", "Misdirection"),
        ("No Cost EMI", "Misdirection"),
        ("Free Delivery", "Misdirection"),
        ("10 days Replacement", "Misdirection"),
        ("Only 1 left in stock", "Scarcity")
    ]
    # Oversample the explicit keywords we care about so the model learns them heavily
    for _ in range(30):
        for text, cat in extra_patterns:
            texts.append(text)
            labels.append(cat)

    # 3. Load classifications (Not Dark)
    with open('training_data/pattern_classifications.csv', 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            if not row or len(row) < 2: continue
            text = row[0].strip()
            cls = row[1].strip()
            # 0 means Not Dark in pattern_classifications.csv
            if text and cls == '0':
                texts.append(text)
                labels.append("Not Dark")
                
    return texts, labels

def clean_text(text):
    text = str(text).lower()
    text = re.sub(r'\W', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

print("[1] Loading and balancing dataset...")
texts, labels = load_data()
cleaned_texts = [clean_text(t) for t in texts]

# Balance "Not Dark" so it doesn't overwhelm the multi-class dark patterns
dark_count = sum([1 for l in labels if l != "Not Dark"])
not_dark_indices = [i for i, l in enumerate(labels) if l == "Not Dark"]

print(f"Total Dark Patterns: {dark_count}, Total Not Dark: {len(not_dark_indices)}")

# Cap Not Dark aggressively so the model does not collapse
if len(not_dark_indices) > (dark_count // 2):
    import random
    random.seed(42)
    # We deliberately give fewer 'Not Dark' examples so it defaults to flagging dark patterns
    keep_not_dark = set(random.sample(not_dark_indices, dark_count // 2))
    
    final_texts = []
    final_labels = []
    for i, (t, l) in enumerate(zip(cleaned_texts, labels)):
        if l == "Not Dark" and i not in keep_not_dark:
            continue
        final_texts.append(t)
        final_labels.append(l)
else:
    final_texts = cleaned_texts
    final_labels = labels

# IMPORTANT: Shuffle the dataset before slicing into validation split
combined = list(zip(final_texts, final_labels))
import random
random.seed(42)
random.shuffle(combined)
final_texts, final_labels = zip(*combined)

# Manual Oversampling for better Neural Network stability
from collections import Counter
c = Counter(final_labels)
print(f"Class distribution before oversampling: {c}")

# Find max class count
max_count = max(c.values())

# Duplicate minority classes to match the max count perfectly
balanced_texts = []
balanced_labels = []

for cls, count in c.items():
    # Find all indices for this class
    indices = [i for i, l in enumerate(final_labels) if l == cls]
    
    # Calculate how many times to repeat
    multiplier = max_count // count
    remainder = max_count % count
    
    for _ in range(multiplier):
        for idx in indices:
            balanced_texts.append(final_texts[idx])
            balanced_labels.append(final_labels[idx])
    
    # Add remainder
    for idx in indices[:remainder]:
        balanced_texts.append(final_texts[idx])
        balanced_labels.append(final_labels[idx])

c2 = Counter(balanced_labels)
print(f"Class distribution AFTER oversampling: {c2}")

# Shuffle again
combined = list(zip(balanced_texts, balanced_labels))
import random
random.seed(42)
random.shuffle(combined)
balanced_texts, balanced_labels = zip(*combined)

print(f"Final balanced training set size: {len(balanced_texts)}")

print("[2] Tokenizing and Pad Sequences...")
tok = Tokenizer(num_words=5000, oov_token="<OOV>")
tok.fit_on_texts(balanced_texts)
X = tok.texts_to_sequences(balanced_texts)
X = pad_sequences(X, maxlen=50, padding='post', truncating='post')

enc = LabelEncoder()
y = enc.fit_transform(balanced_labels)
num_classes = len(enc.classes_)

print(f"Classes ({num_classes}): {enc.classes_}")

print("[3] Building and Training Neural Network...")
from tensorflow.keras.layers import GlobalAveragePooling1D

model = Sequential([
    Embedding(input_dim=5000, output_dim=64, input_length=50),
    GlobalAveragePooling1D(),
    Dense(64, activation='relu'),
    Dropout(0.2),
    Dense(32, activation='relu'),
    Dense(num_classes, activation='softmax')
])

model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
model.fit(X, y, epochs=20, batch_size=32, validation_split=0.2)

print("[4] Saving model artifacts...")
model.save("model/dark_pattern_model.h5")
with open("model/tokenizer.pkl", "wb") as f: pickle.dump(tok, f)
with open("model/label_encoder.pkl", "wb") as f: pickle.dump(enc, f)

print("✅ Full model retraining completed successfully!")
