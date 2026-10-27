"""
Build a single, self-contained standalone.html that runs with no server.

It inlines pdf.js + its worker as base64 blob modules (blob URLs bypass the
browser's block on ES modules loaded from file://), reuses the measurement and
PDF-loading code from static/js/, and uses plain HTML controls (no Web Awesome,
no internet).

Run:  python make_standalone.py
Output: standalone.html in the project root. Double-click it to use the tool.
"""
import base64
import pathlib

ROOT = pathlib.Path(__file__).parent
BUILD = ROOT / "static" / "js" / "pdfjs-5.4.149-dist" / "build"

pdf_b64 = base64.b64encode((BUILD / "pdf.mjs").read_bytes()).decode()
worker_b64 = base64.b64encode((BUILD / "pdf.worker.mjs").read_bytes()).decode()

# Reuse the real app code. pdfLoad.js is an ES module (uses `export`); strip the
# export keywords so it can run as a classic script inside initApp().
pdfload = (ROOT / "static" / "js" / "pdfLoad.js").read_text(encoding="utf-8")
pdfload = pdfload.replace("export function", "function")
# It reads a global `workerSrc`; we provide that in initApp from the worker blob.
measure = (ROOT / "static" / "js" / "measure.js").read_text(encoding="utf-8")

CSS = r"""
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
    margin: 0;
    overflow: hidden;
    background: #131316;
    color: #e8e8ea;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
main { height: 100vh; display: flex; flex-direction: column; padding: 0 12px; }
header {
    flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 4px;
}
header .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; }
header .brand .logo { font-size: 1.1rem; }

#toolbar {
    flex: 0 0 auto;
    display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
    padding: 4px;
    border-top: 1px solid #3a3a40; border-bottom: 1px solid #3a3a40;
    margin: 2px 0; background: #131316;
}
.tb-sep { width: 1px; align-self: stretch; background: #44444c; margin: 0 4px; }
.readout { font-size: 0.85rem; opacity: 0.85; white-space: nowrap; }

.btn {
    font: inherit; font-size: 0.85rem; line-height: 1;
    height: 30px; padding: 0 10px;
    background: #e9e9ec; color: #18181b;
    border: 1px solid #c9c9cf; border-radius: 6px; cursor: pointer;
}
.btn:hover { background: #f4f4f6; }
.btn:active { background: #dadadf; }
.btn.danger { background: #e5484d; border-color: #c93b40; color: #fff; }
.btn.danger:hover { background: #ec5b60; }
.btn[data-active] { outline: 2px solid #4dabf7; outline-offset: 1px; }

#toolbar select, #toolbar input {
    font: inherit; font-size: 0.85rem; height: 30px;
    background: #1f1f24; color: #e8e8ea;
    border: 1px solid #44444c; border-radius: 6px; padding: 0 6px;
}
#ratio-input { width: 5rem; }

.hint { flex: 0 0 auto; font-size: 0.72rem; opacity: 0.6; margin: 2px 0; }

#pages-container {
    flex: 1 1 auto; overflow: auto; position: relative;
    display: flex; flex-direction: column; align-items: safe center;
    gap: 16px; padding: 12px 0 48px;
}
#pages-container .empty { opacity: 0.5; margin-top: 40px; text-align: center; width: 100%; }
.page-wrap {
    position: relative; width: fit-content; line-height: 0;
    background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.5);
}
.page-wrap .pdf-canvas { display: block; }
.page-wrap .overlay-canvas { position: absolute; top: 0; left: 0; pointer-events: none; }

#measure-list {
    position: fixed; right: 12px; bottom: 12px; width: 260px; max-height: 45vh;
    overflow-y: auto; padding: 10px 12px; font-size: 0.9rem;
    background: #1b1b1f; border: 1px solid #44444c; border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5); z-index: 10;
}
#measure-list .measure-empty { opacity: 0.6; }
#measure-list .measure-page { font-weight: 600; opacity: 0.8; margin: 0 0 4px; }
#measure-list ul { list-style: none; padding: 0; margin: 0; }
#measure-list li {
    display: flex; align-items: center; gap: 8px; padding: 4px 0;
    border-bottom: 1px solid #333;
}
#measure-list .dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; }
#measure-list .dot.distance { background: #4dabf7; }
#measure-list .dot.area { background: #51cf66; }
#measure-list .del-measure {
    margin-left: auto; background: none; border: none; color: inherit;
    cursor: pointer; font-size: 1.1rem; line-height: 1; opacity: 0.6;
}
#measure-list .del-measure:hover { opacity: 1; color: #ff6b6b; }
"""

BODY = r"""
<main>
    <header>
        <div class="brand"><span class="logo">&#128207;</span> PDF Measure</div>
        <div class="readout">Runs locally &middot; no upload</div>
    </header>

    <input id="file-input" type="file" accept="application/pdf,.pdf" hidden />

    <div id="toolbar">
        <button class="btn" onclick="document.getElementById('file-input').click()">&#128193; Open Local PDF</button>
        <span class="tb-sep"></span>
        <button class="btn" data-tool="calibrate" onclick="PDFMeasure.setMode('calibrate')">Set Scale</button>
        <span class="readout">or 1 :</span>
        <input id="ratio-input" type="number" min="0" step="any" placeholder="48" />
        <button class="btn" onclick="applyRatio()">Apply</button>
        <select id="unit-select">
            <option value="ft">feet</option>
            <option value="in">inches</option>
            <option value="yd">yards</option>
            <option value="m">meters</option>
            <option value="cm">cm</option>
            <option value="mm">mm</option>
        </select>
        <span id="scale-readout" class="readout">Scale: not set</span>
        <span class="tb-sep"></span>
        <button class="btn" data-tool="distance" onclick="PDFMeasure.setMode('distance')">Measure Distance</button>
        <button class="btn" data-tool="area" onclick="PDFMeasure.setMode('area')">Measure Area</button>
        <button class="btn" data-tool="none" onclick="PDFMeasure.setMode('none')">Scroll / Off</button>
        <button class="btn danger" onclick="PDFMeasure.clearAll()">Clear All</button>
        <span class="tb-sep"></span>
        <button class="btn" onclick="pdfPrevPage()" title="Previous page">&#9664;</button>
        <span id="page-indicator" class="readout">&ndash; / &ndash;</span>
        <button class="btn" onclick="pdfNextPage()" title="Next page">&#9654;</button>
        <span class="tb-sep"></span>
        <button class="btn" onclick="pdfSetZoom(pdfGetZoom() - 0.25)">&minus;</button>
        <span id="zoom-readout" class="readout">&mdash;</span>
        <button class="btn" onclick="pdfSetZoom(pdfGetZoom() + 0.25)">+</button>
        <button class="btn" onclick="pdfFitToWidth()">Fit Width</button>
    </div>

    <p class="hint">Open a PDF, set a scale (draw a known line or enter 1:N), then measure. Click points and double-click (or Enter) to finish. Hold Shift to lock a segment horizontal/vertical. Esc cancels.</p>

    <div id="pages-container"><p class="empty">Open a local PDF to begin.</p></div>
    <div id="measure-list"></div>
</main>
"""

APP_JS = (
    "function initApp(){\n"
    "  var pc = document.querySelector('#pages-container .empty'); if (pc) pc.remove();\n"
    "  const workerSrc = globalThis.__workerSrc;\n"
    + pdfload + "\n"
    + measure + "\n"
    "  globalThis.applyRatio = function(){\n"
    "    const el = document.getElementById('ratio-input');\n"
    "    const n = parseFloat(el.value);\n"
    "    if (!(n > 0)) { el.focus(); return; }\n"
    "    PDFMeasure.setRatio(n);\n"
    "  };\n"
    "  document.getElementById('file-input').addEventListener('change', function(evt){\n"
    "    display_pdf_local(evt); evt.target.value='';\n"
    "  });\n"
    "  document.getElementById('ratio-input').addEventListener('keydown', function(e){\n"
    "    if (e.key === 'Enter') applyRatio();\n"
    "  });\n"
    "}\n"
)

LOADER_JS = (
    "const PDFJS_B64 = \"" + pdf_b64 + "\";\n"
    "const WORKER_B64 = \"" + worker_b64 + "\";\n"
    "function _b64url(b64, type){\n"
    "  const bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);\n"
    "  for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);\n"
    "  return URL.createObjectURL(new Blob([bytes], {type}));\n"
    "}\n"
    "(async () => {\n"
    "  try {\n"
    "    const pdfjs = await import(_b64url(PDFJS_B64, 'text/javascript'));\n"
    "    globalThis.pdfjsLib = pdfjs;\n"
    "    globalThis.__workerSrc = _b64url(WORKER_B64, 'text/javascript');\n"
    "    initApp();\n"
    "  } catch (err) {\n"
    "    console.error(err);\n"
    "    const c = document.getElementById('pages-container');\n"
    "    if (c) c.innerHTML = '<p class=\\'empty\\' style=\\'color:#ff6b6b\\'>Failed to load the PDF engine: ' + err + '</p>';\n"
    "  }\n"
    "})();\n"
)

HTML = (
    "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\" />\n"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n"
    "<title>PDF Measure</title>\n<style>\n" + CSS + "\n</style>\n</head>\n<body>\n"
    + BODY
    + "\n<script>\n" + APP_JS + "\n</script>\n"
    + "<script>\n" + LOADER_JS + "\n</script>\n"
    "</body>\n</html>\n"
)

# Root copy for offline double-click use.
out = ROOT / "standalone.html"
out.write_text(HTML, encoding="utf-8")
print(f"Wrote {out} ({out.stat().st_size / 1_000_000:.1f} MB)")

# docs/ copy for GitHub Pages (served at https://<user>.github.io/pdf-editor/).
docs = ROOT / "docs"
docs.mkdir(exist_ok=True)
(docs / "index.html").write_text(HTML, encoding="utf-8")
(docs / ".nojekyll").write_text("", encoding="utf-8")  # serve files as-is
print(f"Wrote {docs / 'index.html'}")
