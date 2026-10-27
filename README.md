# PDF Editor

A browser-based PDF viewer with measurement tools: open a local PDF, set a scale
(draw a known line, or enter a drawing ratio like 1:48), and measure distances
and areas. Continuous multi-page scroll, fit-to-width, zoom, and Shift to lock a
segment horizontal/vertical.

## Use it with no server (recommended)

Just open **`standalone.html`** in a browser (double-click it). It's fully
self-contained — pdf.js is embedded, nothing is uploaded, and it works offline.
Click **Open Local PDF** to begin. This is the same thing published via GitHub
Pages from the `docs/` folder.

### Rebuilding the standalone
`standalone.html` (and `docs/index.html`) are generated from the code in
`static/js/`. After changing those files, regenerate them with:
```
python make_standalone.py
```

## Run the Flask app (optional)

This is just a thin local dev server that serves the same tool from
`templates/index.html`; the standalone file above does everything without it.

### Steps to run
1. Create python virtual environment
```
python -m venv .
Scripts/activate
pip install -r requirements.txt
```
2. Download [pdf.js](https://github.com/mozilla/pdf.js/releases/download/v5.4.149/pdfjs-5.4.149-dist.zip)
3. Extract and save **pdfjs-5.4.149-dist** folder into **\<root-folder>/static/js/**
4. Run the dev server with
```
python app.py
```
