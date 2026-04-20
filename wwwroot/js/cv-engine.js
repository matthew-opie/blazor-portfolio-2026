window.cvEngine = (() => {
    let _video      = null;
    let _canvas     = null;
    let _tempCanvas = null;
    let _tempCtx    = null;
    let _running    = false;
    let _animId     = null;

    let _algorithm = 'passthrough';
    let _params    = {};
    let _mirror    = false;
    let _paused    = false;
    let _showFps   = false;

    let _objTemplate = null;   // RGBA Mat captured by the user for object detection

    let _fps        = 0;
    let _frameCount = 0;
    let _lastFpsTime = 0;

    const algorithms = {
        passthrough: (src, dst) => {
            src.copyTo(dst);
        },

        grayscale: (src, dst) => {
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
            cv.cvtColor(dst, dst, cv.COLOR_GRAY2RGBA);
        },

        blur: (src, dst, p) => {
            let k = Math.max(1, Math.round(p.kernelSize ?? 5));
            if (k % 2 === 0) k++;
            cv.GaussianBlur(src, dst, new cv.Size(k, k), p.sigma ?? 0);
        },

        canny: (src, dst, p) => {
            const gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.Canny(gray, gray, p.low ?? 50, p.high ?? 150);
            cv.cvtColor(gray, dst, cv.COLOR_GRAY2RGBA);
            gray.delete();
        },

        threshold: (src, dst, p) => {
            const gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.threshold(gray, gray, p.thresh ?? 127, 255, cv.THRESH_BINARY);
            cv.cvtColor(gray, dst, cv.COLOR_GRAY2RGBA);
            gray.delete();
        },

        invert: (src, dst) => {
            const bgr = new cv.Mat();
            try {
                cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);
                cv.bitwise_not(bgr, bgr);
                cv.cvtColor(bgr, dst, cv.COLOR_BGR2RGBA);
            } finally {
                bgr.delete();
            }
        },

        colorDetect: (() => {
            let _cachedH = 0, _lastR = -1, _lastG = -1, _lastB = -1;
            let _ex = 0, _ey = 0, _ew = 0, _eh = 0, _emaReady = false; // EMA state

            // Compute OpenCV hue (0-179) from RGB without allocating any Mats
            function rgbToOcvHue(r, g, b) {
                const rn = r / 255, gn = g / 255, bn = b / 255;
                const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
                const d = max - min;
                if (d < 0.001) return 0;
                let h;
                if      (max === rn) h = ((gn - bn) / d + 6) % 6;
                else if (max === gn) h = (bn - rn) / d + 2;
                else                 h = (rn - gn) / d + 4;
                return Math.round(h * 30); // *60/2 → 0-179
            }

            function makeBounds(lo0, lo1, lo2, hi0, hi1, hi2) {
                const lo = cv.matFromArray(1, 1, cv.CV_8UC3, [lo0, lo1, lo2]);
                const hi = cv.matFromArray(1, 1, cv.CV_8UC3, [hi0, hi1, hi2]);
                return [lo, hi];
            }

            return (src, dst, p) => {
                const r      = Math.round(p.r          ?? 255);
                const g      = Math.round(p.g          ?? 0);
                const b      = Math.round(p.b          ?? 0);
                const tolH   = Math.round((p.tolerance ?? 15) * 0.9);
                const satMin = Math.round(p.satMin     ?? 50);

                if (r !== _lastR || g !== _lastG || b !== _lastB) {
                    _cachedH = rgbToOcvHue(r, g, b);
                    _lastR = r; _lastG = g; _lastB = b;
                }
                const H = _cachedH;

                const bgr  = new cv.Mat();
                const hsv  = new cv.Mat();
                const mask = new cv.Mat();
                const gray = new cv.Mat();
                try {
                    cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);
                    cv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV);

                    if (H - tolH < 0) {
                        const wrapLo = 180 + H - tolH;
                        const m1 = new cv.Mat(), m2 = new cv.Mat();
                        try {
                            const [lo1, hi1] = makeBounds(wrapLo, satMin, 40, 179,      255, 255);
                            const [lo2, hi2] = makeBounds(0,      satMin, 40, H + tolH, 255, 255);
                            cv.inRange(hsv, lo1, hi1, m1);
                            cv.inRange(hsv, lo2, hi2, m2);
                            cv.bitwise_or(m1, m2, mask);
                            [lo1, hi1, lo2, hi2].forEach(m => m.delete());
                        } finally { m1.delete(); m2.delete(); }
                    } else if (H + tolH > 179) {
                        const wrapHi = H + tolH - 180;
                        const m1 = new cv.Mat(), m2 = new cv.Mat();
                        try {
                            const [lo1, hi1] = makeBounds(H - tolH, satMin, 40, 179,    255, 255);
                            const [lo2, hi2] = makeBounds(0,        satMin, 40, wrapHi, 255, 255);
                            cv.inRange(hsv, lo1, hi1, m1);
                            cv.inRange(hsv, lo2, hi2, m2);
                            cv.bitwise_or(m1, m2, mask);
                            [lo1, hi1, lo2, hi2].forEach(m => m.delete());
                        } finally { m1.delete(); m2.delete(); }
                    } else {
                        const [lo, hi] = makeBounds(H - tolH, satMin, 40, H + tolH, 255, 255);
                        cv.inRange(hsv, lo, hi, mask);
                        lo.delete(); hi.delete();
                    }

                    // Dilate to merge nearby patches, then one light erosion to drop
                    // isolated false-positive blobs while keeping large real objects
                    const kernel  = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(25, 25));
                    const erodeK  = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(12, 12));
                    const cleaned = new cv.Mat();
                    try {
                        cv.dilate(mask, cleaned, kernel, new cv.Point(-1, -1), 3);
                        cv.erode(cleaned, cleaned, erodeK, new cv.Point(-1, -1), 1);

                        src.copyTo(dst);
                        const minArea   = src.rows * src.cols * 0.002; // 0.2% of frame
                        const contours  = new cv.MatVector();
                        const hierarchy = new cv.Mat();
                        try {
                            cv.findContours(cleaned, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
                            let bestScore = p.minFill ?? 0.25, bestRect = null; // minimum fill density to draw
                            for (let i = 0; i < contours.size(); i++) {
                                const cnt = contours.get(i);
                                const area = cv.contourArea(cnt);
                                if (area > minArea) {
                                    const r    = cv.boundingRect(cnt);
                                    const density = area / (r.width * r.height); // 0..1, higher = tighter match
                                    if (density > bestScore) {
                                        bestScore = density;
                                        bestRect  = r;
                                    }
                                }
                                cnt.delete();
                            }
                            if (bestRect) {
                                const a = 0.25;
                                if (!_emaReady) {
                                    _ex = bestRect.x; _ey = bestRect.y;
                                    _ew = bestRect.width; _eh = bestRect.height;
                                    _emaReady = true;
                                } else {
                                    _ex = a * bestRect.x + (1 - a) * _ex;
                                    _ey = a * bestRect.y + (1 - a) * _ey;
                                    _ew = a * bestRect.width  + (1 - a) * _ew;
                                    _eh = a * bestRect.height + (1 - a) * _eh;
                                }
                                cv.rectangle(dst,
                                    new cv.Point(Math.round(_ex), Math.round(_ey)),
                                    new cv.Point(Math.round(_ex + _ew), Math.round(_ey + _eh)),
                                    new cv.Scalar(57, 255, 20, 255), 3);
                            } else {
                                _emaReady = false; // reset when object disappears
                            }
                        } finally {
                            contours.delete();
                            hierarchy.delete();
                        }
                    } finally {
                        kernel.delete();
                        erodeK.delete();
                        cleaned.delete();
                    }
                } finally {
                    bgr.delete(); hsv.delete(); mask.delete(); gray.delete();
                }
            };
        })(),

        objectDetect: (src, dst, p) => {
            src.copyTo(dst);
            if (!_objTemplate || _objTemplate.empty()) return;

            const angleTol   = Math.round(p.angleTolerance ?? 0);
            const scaleRange = p.scaleRange ?? 0;
            const threshold  = p.threshold ?? 0.3;

            const gray    = new cv.Mat();
            const tplGray = new cv.Mat();
            try {
                cv.cvtColor(src,          gray,    cv.COLOR_RGBA2GRAY);
                cv.cvtColor(_objTemplate, tplGray, cv.COLOR_RGBA2GRAY);

                // Angles: 0 plus steps of 15° up to ±angleTol (capped at ~13 entries)
                const angles = [0];
                if (angleTol > 0) {
                    const step = angleTol <= 30 ? 5 : 15;
                    for (let a = step; a <= angleTol; a += step) angles.push(a, -a);
                }

                // Up to 5 scales: 1, 1±half, 1±full
                const scales = [1.0];
                if (scaleRange > 0) {
                    const h = scaleRange / 2;
                    scales.push(1 + h, Math.max(0.2, 1 - h),
                                1 + scaleRange, Math.max(0.2, 1 - scaleRange));
                }

                let bestVal = threshold, bestLoc = null, bestW = tplGray.cols, bestH = tplGray.rows, bestAngle = 0, bestScale = 1;

                for (const scale of scales) {
                    const tw = Math.round(tplGray.cols * scale);
                    const th = Math.round(tplGray.rows * scale);
                    if (tw < 8 || th < 8 || tw >= gray.cols || th >= gray.rows) continue;

                    const scaledTpl = new cv.Mat();
                    cv.resize(tplGray, scaledTpl, new cv.Size(tw, th));
                    try {
                        for (const angle of angles) {
                            const rotTpl = angle !== 0 ? rotateMat(scaledTpl, angle) : scaledTpl;
                            try {
                                if (rotTpl.cols >= gray.cols || rotTpl.rows >= gray.rows) continue;
                                const result = new cv.Mat();
                                cv.matchTemplate(gray, rotTpl, result, cv.TM_CCOEFF_NORMED);
                                const mmr = cv.minMaxLoc(result);
                                result.delete();
                                if (mmr.maxVal > bestVal) {
                                    bestVal   = mmr.maxVal;
                                    bestLoc   = mmr.maxLoc;
                                    bestW     = rotTpl.cols;
                                    bestH     = rotTpl.rows;
                                    bestAngle = angle;
                                    bestScale = scale;
                                }
                            } finally {
                                if (angle !== 0) rotTpl.delete();
                            }
                        }
                    } finally {
                        scaledTpl.delete();
                    }
                }

                if (bestLoc) {
                    // Centre of the matched bounding box
                    const cx = bestLoc.x + bestW / 2;
                    const cy = bestLoc.y + bestH / 2;
                    // Half-extents of the ORIGINAL (unrotated) template at this scale
                    const hw = (tplGray.cols * bestScale) / 2;
                    const hh = (tplGray.rows * bestScale) / 2;
                    const rad = bestAngle * Math.PI / 180;
                    const cosA = Math.cos(rad), sinA = Math.sin(rad);
                    // Rotate each corner of the original template rect around the centre
                    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => [
                        Math.round(cx + lx * cosA - ly * sinA),
                        Math.round(cy + lx * sinA + ly * cosA),
                    ]);
                    const pts = cv.matFromArray(4, 1, cv.CV_32SC2, corners.flat());
                    const ptVec = new cv.MatVector();
                    ptVec.push_back(pts);
                    cv.polylines(dst, ptVec, true, new cv.Scalar(57, 255, 20, 255), 3);
                    ptVec.delete();
                    pts.delete();
                    cv.putText(dst, `${Math.round(bestVal * 100)}%`,
                        new cv.Point(corners[0][0], corners[0][1] - 6),
                        cv.FONT_HERSHEY_SIMPLEX, 0.65, new cv.Scalar(57, 255, 20, 255), 2);
                }
            } finally {
                gray.delete();
                tplGray.delete();
            }
        },

        cocoSsd: (() => {
            let _model       = null;
            let _loading     = false;
            let _inferring   = false;
            let _lastDets    = [];
            let _loadError   = null;
            let _inferCanvas = null; // reused across inference calls

            async function tryInit() {
                if (_model || _loading || typeof cocoSsd === 'undefined') return;
                _loading   = true;
                _loadError = null;
                try {
                    _model = await cocoSsd.load();
                } catch(e) {
                    console.error('[coco-ssd]', e);
                    _loadError = e.message ?? String(e);
                }
                _loading = false;
            }

            function drawStatus(dst, msg) {
                cv.putText(dst, msg, new cv.Point(12, 36),
                    cv.FONT_HERSHEY_SIMPLEX, 0.8, new cv.Scalar(57, 255, 20, 255), 2);
            }

            return (src, dst, p) => {
                src.copyTo(dst);

                if (_loadError) { drawStatus(dst, `COCO-SSD: ${_loadError.slice(0, 50)}`); return; }
                if (!_model) {
                    tryInit();
                    drawStatus(dst, _loading ? 'Loading COCO-SSD model...' : 'Initializing...');
                    return;
                }

                // Show status until the first inference result arrives
                if (_inferring && _lastDets.length === 0) drawStatus(dst, 'Running inference...');

                // Draw whatever detections last completed
                for (const det of _lastDets) {
                    const [bx, by, bw, bh] = det.bbox.map(Math.round);
                    cv.rectangle(dst,
                        new cv.Point(bx, by),
                        new cv.Point(bx + bw, by + bh),
                        new cv.Scalar(57, 255, 20, 255), 2);
                    cv.putText(dst,
                        `${det.class} ${Math.round(det.score * 100)}%`,
                        new cv.Point(bx, Math.max(by - 6, 14)),
                        cv.FONT_HERSHEY_SIMPLEX, 0.55, new cv.Scalar(57, 255, 20, 255), 2);
                }

                // Fire the next inference pass if the previous one finished
                if (!_inferring) {
                    _inferring = true;

                    // Render the current (possibly mirrored) frame to a canvas for TF.js
                    if (!_inferCanvas ||
                        _inferCanvas.width  !== src.cols ||
                        _inferCanvas.height !== src.rows) {
                        _inferCanvas = document.createElement('canvas');
                        _inferCanvas.width  = src.cols;
                        _inferCanvas.height = src.rows;
                    }
                    cv.imshow(_inferCanvas, src);

                    _model.detect(_inferCanvas, 20, p.confThresh ?? 0.35)
                        .then(dets => { _lastDets = dets; })
                        .catch(e => console.warn('[coco-ssd]', e))
                        .finally(() => { _inferring = false; });
                }
            };
        })(),

        faceDetect: (() => {
            let _classifier = null;
            let _loading    = false;
            // EMA state per face slot (track up to 4 faces)
            let _emaFaces = [];

            function tryInit() {
                if (_classifier || _loading) return;
                _loading = true;
                fetch('/data/haarcascade_frontalface_default.xml')
                    .then(r => r.arrayBuffer())
                    .then(buf => {
                        try { cv.FS_unlink('face.xml'); } catch { /* first run */ }
                        cv.FS_createDataFile('/', 'face.xml', new Uint8Array(buf), true, false, false);
                        const c = new cv.CascadeClassifier();
                        c.load('face.xml');
                        _classifier = c;
                        _loading    = false;
                    });
            }

            return (src, dst, p) => {
                src.copyTo(dst);
                if (!_classifier) { tryInit(); return; }

                const gray  = new cv.Mat();
                const faces = new cv.RectVector();
                try {
                    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                    cv.equalizeHist(gray, gray);

                    const minSz = Math.round(p.minSize ?? 80);
                    _classifier.detectMultiScale(
                        gray, faces,
                        p.scaleFactor ?? 1.1,
                        Math.round(p.minNeighbors ?? 3),
                        0,
                        new cv.Size(minSz, minSz),
                        new cv.Size(0, 0)
                    );

                    // Pick only the largest detected face
                    let best = null;
                    for (let i = 0; i < faces.size(); i++) {
                        const f = faces.get(i);
                        if (!best || f.width * f.height > best.width * best.height) best = f;
                    }

                    if (best) {
                        const a = 0.25;
                        if (!_emaFaces[0]) {
                            _emaFaces[0] = { x: best.x, y: best.y, w: best.width, h: best.height };
                        } else {
                            _emaFaces[0].x = a * best.x + (1 - a) * _emaFaces[0].x;
                            _emaFaces[0].y = a * best.y + (1 - a) * _emaFaces[0].y;
                            _emaFaces[0].w = a * best.width  + (1 - a) * _emaFaces[0].w;
                            _emaFaces[0].h = a * best.height + (1 - a) * _emaFaces[0].h;
                        }
                        const e = _emaFaces[0];
                        cv.rectangle(dst,
                            new cv.Point(Math.round(e.x), Math.round(e.y)),
                            new cv.Point(Math.round(e.x + e.w), Math.round(e.y + e.h)),
                            new cv.Scalar(57, 255, 20, 255), 2);
                    } else {
                        _emaFaces[0] = null; // reset when face disappears
                    }
                } finally {
                    gray.delete();
                    faces.delete();
                }
            };
        })(),
    };

    function rotateMat(mat, deg) {
        const rad = deg * Math.PI / 180;
        const c   = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
        const nw  = Math.round(mat.cols * c + mat.rows * s);
        const nh  = Math.round(mat.cols * s + mat.rows * c);
        const M   = cv.getRotationMatrix2D(new cv.Point(mat.cols / 2, mat.rows / 2), deg, 1);
        M.data64F[2] += (nw - mat.cols) / 2;
        M.data64F[5] += (nh - mat.rows) / 2;
        const out = new cv.Mat();
        cv.warpAffine(mat, out, M, new cv.Size(nw, nh));
        M.delete();
        return out;
    }

    function loop() {
        if (!_running) return;

        // Schedule next frame first — loop survives any error below
        _animId = requestAnimationFrame(loop);

        const now = performance.now();
        _frameCount++;
        if (now - _lastFpsTime >= 1000) {
            _fps = _frameCount;
            _frameCount = 0;
            _lastFpsTime = now;
        }

        if (_paused || _video?.readyState !== 4) return;

        let src = null, dst = null;
        try {
            _tempCtx.drawImage(_video, 0, 0, _tempCanvas.width, _tempCanvas.height);
            src = cv.imread(_tempCanvas);
            if (_mirror) cv.flip(src, src, 1);

            dst = new cv.Mat();
            const fn = algorithms[_algorithm];
            if (fn) fn(src, dst, _params);
            else src.copyTo(dst);

            const out = dst.empty() ? src : dst;

            if (_showFps) {
                cv.putText(out, `${_fps} fps`,
                    new cv.Point(10, 28), cv.FONT_HERSHEY_SIMPLEX,
                    0.8, new cv.Scalar(0, 255, 0, 255), 2);
            }

            cv.imshow(_canvas, out);
        } catch (e) {
            console.warn('[cv-engine]', e);
        } finally {
            src?.delete();
            dst?.delete();
        }
    }

    async function loadOpenCV() {
        if (window.cv?.Mat) return;

        await new Promise((resolve, reject) => {
            const script   = document.createElement('script');
            script.async   = true;
            script.src     = 'https://docs.opencv.org/4.10.0/opencv.js';
            script.onerror = () => reject(new Error('Failed to load OpenCV.js'));
            script.onload  = () => {
                const deadline = Date.now() + 30000;
                const poll = setInterval(() => {
                    if (window.cv?.Mat) { clearInterval(poll); resolve(); }
                    else if (Date.now() > deadline) { clearInterval(poll); reject(new Error('OpenCV init timeout')); }
                }, 50);
            };
            document.head.appendChild(script);
        });
    }

    return {
        async init(videoEl, canvasEl) {
            _video  = videoEl;
            _canvas = canvasEl;

            await loadOpenCV();

            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            _video.srcObject = stream;
            await new Promise(r => { _video.onloadedmetadata = r; });
            await _video.play();

            _tempCanvas        = document.createElement('canvas');
            _tempCanvas.width  = _video.videoWidth;
            _tempCanvas.height = _video.videoHeight;
            _tempCtx           = _tempCanvas.getContext('2d', { willReadFrequently: true });

            _running     = true;
            _lastFpsTime = performance.now();
            loop();
        },

        stop() {
            _running = false;
            if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
            if (_video?.srcObject) _video.srcObject.getTracks().forEach(t => t.stop());
        },

        setAlgorithm(name, params) {
            _algorithm = name;
            _params    = params ?? {};
        },

        setParam(key, value) {
            _params[key] = value;
        },

        setMirror(val)  { _mirror  = val; },
        setPause(val)   { _paused  = val; },
        setShowFps(val) { _showFps = val; },

        freezePassthrough() {
            if (_video?.readyState === 4 && _tempCtx) {
                _tempCtx.drawImage(_video, 0, 0, _tempCanvas.width, _tempCanvas.height);
                let src = null;
                try {
                    src = cv.imread(_tempCanvas);
                    if (_mirror) cv.flip(src, src, 1);
                    cv.imshow(_canvas, src);
                } catch { /* ignore */ } finally {
                    src?.delete();
                }
            }
            _paused = true;
        },

        pickColorAt(clientX, clientY) {
            if (!_tempCtx || !_canvas) return null;

            const rect = _canvas.getBoundingClientRect();
            const scale   = Math.min(rect.width / _canvas.width, rect.height / _canvas.height);
            const offX    = (rect.width  - _canvas.width  * scale) / 2;
            const offY    = (rect.height - _canvas.height * scale) / 2;

            let   bx = Math.round((clientX - rect.left - offX) / scale);
            const by = Math.round((clientY - rect.top  - offY) / scale);

            if (bx < 0 || bx >= _tempCanvas.width || by < 0 || by >= _tempCanvas.height) return null;

            // Temp canvas is always raw/unmirrored; flip x if mirror is on
            if (_mirror) bx = _tempCanvas.width - 1 - bx;

            const px = _tempCtx.getImageData(bx, by, 1, 1).data;
            return [px[0], px[1], px[2]];
        },

        setObjectTemplate(x1, y1, x2, y2) {
            if (!_tempCanvas || !_tempCtx || !_canvas) return false;

            const rect  = _canvas.getBoundingClientRect();
            const scale = Math.min(rect.width / _canvas.width, rect.height / _canvas.height);
            const offX  = (rect.width  - _canvas.width  * scale) / 2;
            const offY  = (rect.height - _canvas.height * scale) / 2;

            const mapX = cx => Math.round((cx - rect.left - offX) / scale);
            const mapY = cy => Math.round((cy - rect.top  - offY) / scale);

            const dx1 = mapX(x1), dy1 = mapY(y1), dx2 = mapX(x2), dy2 = mapY(y2);
            const lx  = Math.max(0, Math.min(dx1, dx2));
            const ly  = Math.max(0, Math.min(dy1, dy2));
            const lw  = Math.min(_tempCanvas.width  - lx, Math.abs(dx2 - dx1));
            const lh  = Math.min(_tempCanvas.height - ly, Math.abs(dy2 - dy1));
            if (lw < 8 || lh < 8) return false;

            // Build a display-space canvas (with mirror applied if needed),
            // so the cropped template matches the orientation the algorithm sees.
            const disp = document.createElement('canvas');
            disp.width = _tempCanvas.width; disp.height = _tempCanvas.height;
            const dctx = disp.getContext('2d');
            if (_mirror) { dctx.translate(_tempCanvas.width, 0); dctx.scale(-1, 1); }
            dctx.drawImage(_tempCanvas, 0, 0);

            const crop = document.createElement('canvas');
            crop.width = lw; crop.height = lh;
            crop.getContext('2d').drawImage(disp, lx, ly, lw, lh, 0, 0, lw, lh);

            if (_objTemplate) _objTemplate.delete();
            _objTemplate = cv.imread(crop);
            return true;
        },

        clearObjectTemplate() {
            if (_objTemplate) { _objTemplate.delete(); _objTemplate = null; }
        },
    };
})();
