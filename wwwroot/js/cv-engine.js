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
            cv.bitwise_not(src, dst);
        },

        colorDetect: (() => {
            let _cachedH = 0, _lastR = -1, _lastG = -1, _lastB = -1;

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
                            for (let i = 0; i < contours.size(); i++) {
                                const cnt = contours.get(i);
                                if (cv.contourArea(cnt) > minArea) {
                                    const r = cv.boundingRect(cnt);
                                    cv.rectangle(dst,
                                        new cv.Point(r.x, r.y),
                                        new cv.Point(r.x + r.width, r.y + r.height),
                                        new cv.Scalar(57, 255, 20, 255), 3);
                                }
                                cnt.delete();
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

        faceDetect: (() => {
            let _classifier = null;
            let _loading    = false;

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

                    for (let i = 0; i < faces.size(); i++) {
                        const f = faces.get(i);
                        cv.rectangle(dst,
                            new cv.Point(f.x, f.y),
                            new cv.Point(f.x + f.width, f.y + f.height),
                            new cv.Scalar(57, 255, 20, 255), 2);
                    }
                } finally {
                    gray.delete();
                    faces.delete();
                }
            };
        })(),
    };

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
            _tempCtx           = _tempCanvas.getContext('2d');

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
    };
})();
