const { pdfjsLib } = globalThis;

// The workerSrc property shall be specified. (see workerSrc defined in index.html)
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// ---- Module state ---------------------------------------------------------
let currentPdf = null;        // loaded PDFDocumentProxy
let numPages = 0;             // total pages
let currentScale = 1.5;       // display zoom (pdf.js viewport scale), shared by all pages
let fitMode = true;           // when true, zoom auto-fits page WIDTH to the container
let naturalSizes = [];        // 1-indexed: {w, h} per page at scale 1
let pageEls = [];             // 1-indexed: {wrap, pc, oc, renderedScale, task}
let io = null;                // IntersectionObserver for lazy rendering
let renderTimer = null;       // debounce for rendering visible pages

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const MAX_BACKING_DIM = 4096; // cap a page canvas's pixel size (keeps high zoom fast)


// ---- Loading --------------------------------------------------------------

// Load a PDF from a local File (e.g. <input type="file"> change event).
export function display_pdf_local(onchange_evt) {
    const file = onchange_evt.target.files[0];
    if (!file) return;
    const fileReader = new FileReader();
    fileReader.onload = function () {
        const typedarray = new Uint8Array(this.result);
        loadDocument(pdfjsLib.getDocument({ data: typedarray }));
    };
    fileReader.readAsArrayBuffer(file);
}

// Load a PDF from a fetch Response or any source pdf.js accepts.
export function display_pdf(file_obj) {
    loadDocument(pdfjsLib.getDocument(file_obj));
}

async function loadDocument(loadingTask) {
    try {
        const pdf = await loadingTask.promise;
        currentPdf = pdf;
        numPages = pdf.numPages;
        fitMode = true;

        // Record natural (scale 1) sizes so we can fit to width.
        naturalSizes = [null];
        for (let p = 1; p <= numPages; p++) {
            const page = await pdf.getPage(p);
            const vp = page.getViewport({ scale: 1 });
            naturalSizes[p] = { w: vp.width, h: vp.height };
        }

        buildPageStack();
        layout();
    } catch (err) {
        console.error('Failed to load PDF:', err);
    }
}

// Build one stacked wrapper (pdf canvas + overlay canvas) per page.
function buildPageStack() {
    const container = document.getElementById('pages-container');
    if (!container) return;

    if (io) { io.disconnect(); io = null; }
    container.innerHTML = '';
    pageEls = [null];

    for (let p = 1; p <= numPages; p++) {
        const wrap = document.createElement('div');
        wrap.className = 'page-wrap';
        wrap.dataset.page = p;

        const pc = document.createElement('canvas');
        pc.className = 'pdf-canvas';

        const oc = document.createElement('canvas');
        oc.className = 'overlay-canvas';
        oc.dataset.page = p;

        wrap.appendChild(pc);
        wrap.appendChild(oc);
        container.appendChild(wrap);
        pageEls[p] = { wrap, pc, oc, renderedScale: null, task: null };
    }

    // Render pages only as they approach the viewport.
    io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) renderPage(Number(entry.target.dataset.page));
        }
    }, { root: container, rootMargin: '300px 0px' });
    for (let p = 1; p <= numPages; p++) io.observe(pageEls[p].wrap);
}


// ---- Rendering ------------------------------------------------------------

// Zoom that fits the widest page's WIDTH to the container (height is free).
function computeFitWidthScale() {
    const container = document.getElementById('pages-container');
    const availW = ((container ? container.clientWidth : window.innerWidth) || 800) - 4;
    let maxW = 1;
    for (let p = 1; p <= numPages; p++) maxW = Math.max(maxW, naturalSizes[p].w);
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, availW / maxW));
}

// Remember the page (and the spot within it) at the viewer's center, so a
// re-render at a new zoom can keep the same place instead of jumping pages.
function captureAnchor() {
    const container = document.getElementById('pages-container');
    if (!container || pageEls.length <= 1) return null;
    const cRect = container.getBoundingClientRect();
    const centerY = cRect.top + container.clientHeight / 2;
    const centerX = cRect.left + container.clientWidth / 2;
    for (let p = 1; p <= numPages; p++) {
        const w = pageEls[p] && pageEls[p].wrap;
        if (!w) continue;
        const r = w.getBoundingClientRect();
        if (r.bottom >= centerY || p === numPages) {
            return {
                page: p,
                fracY: r.height ? (centerY - r.top) / r.height : 0.5,
                fracX: r.width ? (centerX - r.left) / r.width : 0.5,
            };
        }
    }
    return null;
}

function restoreAnchor(a) {
    if (!a) return;
    const container = document.getElementById('pages-container');
    const w = pageEls[a.page] && pageEls[a.page].wrap;
    if (!container || !w) return;
    container.scrollTop = w.offsetTop + a.fracY * w.offsetHeight - container.clientHeight / 2;
    container.scrollLeft = w.offsetLeft + a.fracX * w.offsetWidth - container.clientWidth / 2;
}

// Device-pixel multiplier for a page, capped so high-zoom canvases stay small.
function outputScaleFor(cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const cap = MAX_BACKING_DIM / Math.max(cssW, cssH);
    return Math.max(0.5, Math.min(dpr, cap));
}

// Cheap pass: size every page/overlay to the current scale (no pixel rendering),
// then let the observer render whatever is near the viewport. This keeps zoom
// responsive even for long documents.
function layout(preserveAnchor = false) {
    if (!currentPdf) return;

    const anchor = preserveAnchor ? captureAnchor() : null;
    if (fitMode) currentScale = computeFitWidthScale();

    const syncPages = [];
    for (let p = 1; p <= numPages; p++) {
        const info = pageEls[p];
        const cssW = Math.floor(naturalSizes[p].w * currentScale);
        const cssH = Math.floor(naturalSizes[p].h * currentScale);

        // Setting only the CSS size reserves layout/scroll space cheaply; the
        // backing bitmap is (re)built in renderPage when the page is visible.
        info.pc.style.width = cssW + 'px';
        info.pc.style.height = cssH + 'px';
        info.renderedScale = null;   // scale changed -> existing bitmap is stale

        syncPages.push({
            page: p,
            overlay: info.oc,
            cssWidth: cssW,
            cssHeight: cssH,
            outputScale: outputScaleFor(cssW, cssH),
        });
    }

    updateReadouts();
    if (globalThis.PDFMeasure) {
        globalThis.PDFMeasure.sync({ scale: currentScale, pages: syncPages });
    }
    if (anchor) restoreAnchor(anchor);

    scheduleRenderVisible();
}

// Render pages currently in (or near) the viewport; debounced so a burst of
// zoom clicks only paints once, at the final scale.
function scheduleRenderVisible() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderVisible, 60);
}

function renderVisible() {
    const container = document.getElementById('pages-container');
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const margin = 300;
    for (let p = 1; p <= numPages; p++) {
        const r = pageEls[p].wrap.getBoundingClientRect();
        if (r.bottom >= cRect.top - margin && r.top <= cRect.bottom + margin) {
            renderPage(p);
        }
    }
}

// Paint one page's PDF bitmap at the current scale (skips if already current).
async function renderPage(p) {
    const info = pageEls[p];
    if (!currentPdf || !info || info.renderedScale === currentScale) return;

    const scaleAtStart = currentScale;
    info.renderedScale = scaleAtStart;   // claim now to avoid duplicate renders
    if (info.task) { try { info.task.cancel(); } catch (e) { /* ignore */ } }

    try {
        const page = await currentPdf.getPage(p);
        if (currentScale !== scaleAtStart) { info.renderedScale = null; return; }

        const viewport = page.getViewport({ scale: scaleAtStart });
        const cssW = Math.floor(viewport.width);
        const cssH = Math.floor(viewport.height);
        const outputScale = outputScaleFor(cssW, cssH);
        const pc = info.pc;
        const ctx = pc.getContext('2d');

        pc.width = Math.floor(cssW * outputScale);
        pc.height = Math.floor(cssH * outputScale);
        pc.style.width = cssW + 'px';
        pc.style.height = cssH + 'px';

        info.task = page.render({
            canvasContext: ctx,
            transform: [outputScale, 0, 0, outputScale, 0, 0],
            viewport,
        });
        await info.task.promise;
    } catch (e) {
        info.renderedScale = null;   // cancelled or failed -> allow a retry
    }
}

function updateReadouts() {
    const zoom = document.getElementById('zoom-readout');
    if (zoom) zoom.textContent = currentPdf ? Math.round(currentScale * 100) + '%' : '—';
    updatePageIndicator();
}

// Which page occupies the top of the viewer (for the page indicator).
function currentVisiblePage() {
    const container = document.getElementById('pages-container');
    const top = container ? container.getBoundingClientRect().top : 0;
    for (let p = 1; p <= numPages; p++) {
        const r = pageEls[p].wrap.getBoundingClientRect();
        if (r.bottom > top + 40) return p;   // first page still visible at the viewer top
    }
    return numPages || 1;
}

function updatePageIndicator() {
    const el = document.getElementById('page-indicator');
    if (el) el.textContent = currentPdf ? `${currentVisiblePage()} / ${numPages}` : '– / –';
}


// ---- Zoom & navigation (exposed to the toolbar) ---------------------------
export function setZoom(scale) {
    if (!currentPdf) return;
    fitMode = false;
    currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    layout(true);
    return currentScale;
}

export function getZoom() {
    return currentScale;
}

export function fitToWidth() {
    if (!currentPdf) return;
    fitMode = true;
    layout(true);
}

export function scrollToPage(n) {
    if (!currentPdf) return;
    const target = Math.min(numPages, Math.max(1, n));
    const container = document.getElementById('pages-container');
    if (!container) return;
    container.scrollTo({ top: pageEls[target].wrap.offsetTop, behavior: 'smooth' });
}

export function nextPage() { scrollToPage(currentVisiblePage() + 1); }
export function prevPage() { scrollToPage(currentVisiblePage() - 1); }

export function hasDocument() {
    return !!currentPdf;
}

// Re-fit when the window resizes, but only while in fit mode.
let resizeTimer = null;
window.addEventListener('resize', () => {
    if (!currentPdf || !fitMode) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => layout(true), 150);
});

// Keep the page indicator in sync while scrolling the viewer.
let scrollTimer = null;
const pagesContainer = document.getElementById('pages-container');
if (pagesContainer) {
    pagesContainer.addEventListener('scroll', () => {
        if (!currentPdf) return;
        updatePageIndicator();
        scheduleRenderVisible();   // render pages as they scroll into view
    }, { passive: true });
}

globalThis.display_pdf = display_pdf;
globalThis.display_pdf_local = display_pdf_local;
globalThis.pdfSetZoom = setZoom;
globalThis.pdfGetZoom = getZoom;
globalThis.pdfFitToWidth = fitToWidth;
globalThis.pdfScrollToPage = scrollToPage;
globalThis.pdfNextPage = nextPage;
globalThis.pdfPrevPage = prevPage;
globalThis.pdfHasDocument = hasDocument;
