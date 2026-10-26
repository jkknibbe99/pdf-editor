/*
 * Measurement overlay for the PDF editor (continuous multi-page view).
 *
 * Each page has its own <canvas class="overlay-canvas"> stacked on top of its
 * pdf canvas. pdfLoad.js builds the stack and calls PDFMeasure.sync() after
 * every (re)render; this module owns all drawing and interaction on them.
 *
 * Coordinate systems
 * ------------------
 *  - CSS pixels: what the mouse reports and what we draw in (each overlay's 2d
 *    context is pre-scaled by devicePixelRatio so 1 unit == 1 CSS pixel).
 *  - PDF points: CSS pixels / scale. Zoom-independent, so all stored geometry
 *    is kept in PDF points and multiplied back up to draw.
 *
 * Calibration (shared across pages): realPerPoint = real-world units per PDF
 * point. A segment of length L PDF points measures L * realPerPoint; area the
 * square of that.
 */

(function () {
    const container = document.getElementById('pages-container');
    if (!container) return;

    const state = {
        mode: 'none',            // 'none' | 'calibrate' | 'distance' | 'area'
        scale: 1,                // current pdf.js zoom (same for every page)
        realPerPoint: null,      // set once calibrated (shared across pages)
        unit: 'ft',              // calibrated unit label
        pages: new Map(),        // page -> { overlay, ctx, cssWidth, cssHeight, outputScale }
        byPage: {},              // page -> [{ type, pts }]
        draft: null,             // { page, pts: [] } in-progress, locked to one page
        hover: null,             // { page, pt } cursor point used for the rubber-band (may be ortho-locked)
        rawHover: null,          // { page, pt } unconstrained cursor, so Shift can re-lock without moving
    };

    const bag = (p) => (state.byPage[p] ||= []);

    const COLORS = {
        calibrate: '#ffb703',
        distance: '#4dabf7',
        area: '#51cf66',
        draft: '#ff6b6b',
    };

    // ---- Geometry helpers -------------------------------------------------
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    function polylineLength(pts) {
        let total = 0;
        for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
        return total;
    }

    function polygonArea(pts) {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            a += p.x * q.y - q.x * p.y;
        }
        return Math.abs(a) / 2;
    }

    const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString();

    // Real inches per 1 unit of each display unit. PDF points are 1/72 inch at
    // the page's true (scale 1) size, so a ratio 1:N gives
    //   realPerPoint = (N / 72) inches/point  ->  / INCHES_PER_UNIT[unit].
    const INCHES_PER_UNIT = {
        in: 1, ft: 12, yd: 36,
        m: 39.3700787, cm: 0.3937007874, mm: 0.03937007874,
    };

    // Effective drawing ratio (the N in 1:N) implied by the current calibration.
    function currentRatio() {
        if (state.realPerPoint == null) return null;
        const per = INCHES_PER_UNIT[state.unit] || 12;
        return state.realPerPoint * per * 72;
    }

    function fmtRatio(n) {
        return (Math.round(n * 10) / 10).toLocaleString();  // 1 decimal, trims .0
    }

    function lengthLabel(points) {
        if (state.realPerPoint == null) return `${fmt(points)} px`;
        return `${fmt(points * state.realPerPoint)} ${state.unit}`;
    }

    function areaLabel(areaPoints) {
        if (state.realPerPoint == null) return `${fmt(areaPoints)} px²`;
        return `${fmt(areaPoints * state.realPerPoint * state.realPerPoint)} ${state.unit}²`;
    }

    // Lock a point to a horizontal or vertical line through `anchor`, picking
    // whichever axis the cursor is currently closer to (Shift behaviour).
    function orthoConstrain(anchor, pt) {
        const dx = Math.abs(pt.x - anchor.x);
        const dy = Math.abs(pt.y - anchor.y);
        return dx >= dy ? { x: pt.x, y: anchor.y } : { x: anchor.x, y: pt.y };
    }

    // ---- Coordinate conversion -------------------------------------------
    function toPdfPoint(overlay, clientX, clientY) {
        const rect = overlay.getBoundingClientRect();
        return { x: (clientX - rect.left) / state.scale, y: (clientY - rect.top) / state.scale };
    }
    const toCss = (p) => ({ x: p.x * state.scale, y: p.y * state.scale });

    // ---- Drawing ----------------------------------------------------------
    function clearCtx(info) {
        info.ctx.setTransform(1, 0, 0, 1, 0, 0);
        info.ctx.clearRect(0, 0, info.overlay.width, info.overlay.height);
        info.ctx.setTransform(info.outputScale, 0, 0, info.outputScale, 0, 0);
    }

    function drawVertex(ctx, p, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawLabel(ctx, text, p, color) {
        ctx.font = '13px system-ui, sans-serif';
        const padX = 5, padY = 3;
        const w = ctx.measureText(text).width;
        const x = p.x + 8, y = p.y - 8;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(x - padX, y - 13 - padY, w + padX * 2, 13 + padY * 2);
        ctx.fillStyle = color;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, x, y);
    }

    function strokePath(ctx, cssPts, color, close) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cssPts[0].x, cssPts[0].y);
        for (let i = 1; i < cssPts.length; i++) ctx.lineTo(cssPts[i].x, cssPts[i].y);
        if (close) ctx.closePath();
        ctx.stroke();
    }

    function drawMeasurement(ctx, m) {
        const cssPts = m.pts.map(toCss);
        const color = COLORS[m.type] || '#fff';
        strokePath(ctx, cssPts, color, m.type === 'area');
        cssPts.forEach(p => drawVertex(ctx, p, color));
        if (m.type === 'distance') {
            drawLabel(ctx, lengthLabel(polylineLength(m.pts)), cssPts[cssPts.length - 1], color);
        } else {
            const c = cssPts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
            c.x /= cssPts.length; c.y /= cssPts.length;
            drawLabel(ctx, areaLabel(polygonArea(m.pts)), c, color);
        }
    }

    function drawDraft(ctx) {
        const color = state.mode === 'calibrate' ? COLORS.calibrate : COLORS.draft;
        const base = state.draft.pts;
        const pts = (state.hover && state.hover.page === state.draft.page) ? [...base, state.hover.pt] : [...base];
        const cssPts = pts.map(toCss);
        const closing = state.mode === 'area' && pts.length > 2;
        strokePath(ctx, cssPts, color, closing);
        base.map(toCss).forEach(p => drawVertex(ctx, p, color));

        const last = cssPts[cssPts.length - 1];
        if (state.mode === 'area' && pts.length > 2) {
            drawLabel(ctx, areaLabel(polygonArea(pts)), last, color);
        } else if (pts.length > 1) {
            drawLabel(ctx, lengthLabel(polylineLength(pts)), last, color);
        }
    }

    function redrawPage(p) {
        const info = state.pages.get(p);
        if (!info) return;
        clearCtx(info);
        for (const m of bag(p)) drawMeasurement(info.ctx, m);
        if (state.draft && state.draft.page === p) drawDraft(info.ctx);
    }

    function redrawAll() {
        for (const p of state.pages.keys()) redrawPage(p);
    }

    // ---- Results list -----------------------------------------------------
    function refreshList() {
        const list = document.getElementById('measure-list');
        if (!list) return;
        const pagesWith = Object.keys(state.byPage)
            .map(Number)
            .filter(p => state.byPage[p] && state.byPage[p].length)
            .sort((a, b) => a - b);

        if (pagesWith.length === 0) {
            list.innerHTML = '<p class="measure-empty">No measurements yet.</p>';
            return;
        }

        let html = '';
        for (const p of pagesWith) {
            const rows = state.byPage[p].map((m, i) => {
                const label = m.type === 'distance'
                    ? `Distance: ${lengthLabel(polylineLength(m.pts))}`
                    : `Area: ${areaLabel(polygonArea(m.pts))}`;
                return `<li><span class="dot ${m.type}"></span>${label}
                    <button data-page="${p}" data-idx="${i}" class="del-measure" title="Remove">×</button></li>`;
            }).join('');
            html += `<p class="measure-page">Page ${p}</p><ul>${rows}</ul>`;
        }
        list.innerHTML = html;
        list.querySelectorAll('.del-measure').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = Number(btn.dataset.page);
                state.byPage[p].splice(Number(btn.dataset.idx), 1);
                redrawPage(p);
                refreshList();
            });
        });
    }

    function updateScaleReadout() {
        const el = document.getElementById('scale-readout');
        if (!el) return;
        if (state.realPerPoint == null) {
            el.textContent = 'Scale: not set';
        } else {
            const perPx = state.realPerPoint / state.scale;
            const ratio = currentRatio();
            el.textContent = `Scale 1:${fmtRatio(ratio)} · 1 px ≈ ${fmt(perPx)} ${state.unit}`;
        }
    }

    // ---- Interaction ------------------------------------------------------
    function finishDraft() {
        if (!state.draft) return;
        const { page, pts } = state.draft;
        if (state.mode === 'distance' && pts.length >= 2) {
            bag(page).push({ type: 'distance', pts: pts.slice() });
        } else if (state.mode === 'area' && pts.length >= 3) {
            bag(page).push({ type: 'area', pts: pts.slice() });
        }
        state.draft = null;
        state.hover = null;
        state.rawHover = null;
        redrawPage(page);
        refreshList();
    }

    function doCalibration() {
        const pts = state.draft.pts;
        const page = state.draft.page;
        const pixelPoints = dist(pts[0], pts[1]);  // in PDF points
        const unit = document.getElementById('unit-select')?.value || state.unit;
        const input = window.prompt(
            `Enter the real-world length of the line you drew (in ${unit}):`, '');
        state.draft = null;
        state.hover = null;
        state.rawHover = null;
        if (input === null) { redrawPage(page); return; }
        const real = parseFloat(input);
        if (!isFinite(real) || real <= 0) {
            window.alert('Please enter a positive number.');
            redrawPage(page);
            return;
        }
        state.unit = unit;
        state.realPerPoint = real / pixelPoints;
        setMode('none');
        updateScaleReadout();
        redrawAll();
        refreshList();
    }

    function onClick(p, overlay, e) {
        if (state.mode === 'none') return;
        if (state.draft && state.draft.page !== p) return;  // a draft stays on one page
        let pt = toPdfPoint(overlay, e.clientX, e.clientY);
        if (e.shiftKey && state.draft && state.draft.pts.length > 0) {
            pt = orthoConstrain(state.draft.pts[state.draft.pts.length - 1], pt);
        }
        if (!state.draft) state.draft = { page: p, pts: [] };
        state.draft.pts.push(pt);
        if (state.mode === 'calibrate' && state.draft.pts.length === 2) {
            doCalibration();
            return;
        }
        redrawPage(p);
    }

    function onMove(p, overlay, e) {
        if (state.mode === 'none' || !state.draft || state.draft.page !== p) return;
        const raw = toPdfPoint(overlay, e.clientX, e.clientY);
        state.rawHover = { page: p, pt: raw };
        const lock = e.shiftKey && state.draft.pts.length > 0;
        const pt = lock ? orthoConstrain(state.draft.pts[state.draft.pts.length - 1], raw) : raw;
        state.hover = { page: p, pt };
        redrawPage(p);
    }

    // Re-lock (or release) the rubber-band when Shift is pressed/released
    // without moving the mouse.
    function recomputeHoverForShift(shift) {
        if (!state.draft || !state.rawHover || state.rawHover.page !== state.draft.page) return;
        if (state.draft.pts.length === 0) return;
        const raw = state.rawHover.pt;
        const last = state.draft.pts[state.draft.pts.length - 1];
        state.hover = { page: state.draft.page, pt: shift ? orthoConstrain(last, raw) : raw };
        redrawPage(state.draft.page);
    }

    function onDbl(p) {
        if (state.mode !== 'distance' && state.mode !== 'area') return;
        if (!state.draft || state.draft.page !== p) return;
        if (state.draft.pts.length > 1) state.draft.pts.pop();  // drop dblclick's extra point
        finishDraft();
    }

    function bindOverlay(p, overlay) {
        if (overlay.__measBound) return;
        overlay.addEventListener('click', (e) => onClick(p, overlay, e));
        overlay.addEventListener('mousemove', (e) => onMove(p, overlay, e));
        overlay.addEventListener('dblclick', () => onDbl(p));
        overlay.addEventListener('mouseleave', () => {
            if (state.hover && state.hover.page === p) {
                state.hover = null;
                state.rawHover = null;
                redrawPage(p);
            }
        });
        overlay.__measBound = true;
    }

    function applyModeCursor(overlay) {
        overlay.style.pointerEvents = state.mode === 'none' ? 'none' : 'auto';
        overlay.style.cursor = state.mode === 'none' ? 'default' : 'crosshair';
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finishDraft();
        else if (e.key === 'Escape' && state.draft) {
            const page = state.draft.page;
            state.draft = null; state.hover = null; state.rawHover = null;
            redrawPage(page);
        } else if (e.key === 'Shift') {
            recomputeHoverForShift(true);
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') recomputeHoverForShift(false);
    });

    // ---- Public control surface ------------------------------------------
    function setMode(mode) {
        state.draft = null;
        state.hover = null;
        state.rawHover = null;
        state.mode = mode;
        for (const info of state.pages.values()) applyModeCursor(info.overlay);
        document.querySelectorAll('[data-tool]').forEach(btn => {
            btn.toggleAttribute('data-active', btn.dataset.tool === mode);
        });
        redrawAll();
    }

    // Called by pdfLoad after every (re)render with the live page geometry.
    function sync({ scale, pages }) {
        state.scale = scale;
        state.pages.clear();
        for (const info of pages) {
            const full = {
                overlay: info.overlay,
                ctx: info.overlay.getContext('2d'),
                cssWidth: info.cssWidth,
                cssHeight: info.cssHeight,
                outputScale: info.outputScale,
            };
            info.overlay.width = Math.floor(info.cssWidth * info.outputScale);
            info.overlay.height = Math.floor(info.cssHeight * info.outputScale);
            info.overlay.style.width = info.cssWidth + 'px';
            info.overlay.style.height = info.cssHeight + 'px';
            bindOverlay(info.page, info.overlay);
            applyModeCursor(info.overlay);
            state.pages.set(info.page, full);
        }
        updateScaleReadout();
        redrawAll();
        refreshList();
    }

    // Set scale directly from a drawing ratio (the N in 1:N), using the
    // currently-selected display unit.
    function setRatio(n) {
        if (!isFinite(n) || n <= 0) return;
        const unit = document.getElementById('unit-select')?.value || state.unit;
        state.unit = unit;
        state.realPerPoint = (n / 72) / (INCHES_PER_UNIT[unit] || 12);
        updateScaleReadout();
        redrawAll();
        refreshList();
    }

    globalThis.PDFMeasure = {
        setMode,
        setRatio,
        sync,
        clearAll() {
            state.byPage = {};
            state.draft = null;
            state.hover = null;
            redrawAll();
            refreshList();
        },
        resetScale() {
            state.realPerPoint = null;
            updateScaleReadout();
            redrawAll();
            refreshList();
        },
    };

    refreshList();
    updateScaleReadout();
})();
