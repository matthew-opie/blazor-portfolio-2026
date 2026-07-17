window.cvEngine = (() => {
    const OPEN_CV_URL       = '/lib/cv/opencv/opencv.js';
    const OPEN_CV_SCRIPT_ID = 'opencv-js';
    const FACE_API_WEIGHTS  = '/lib/cv/face-api/weights';
    const MEDIAPIPE_SELFIE  = '/lib/cv/mediapipe/selfie_segmentation';
    const MODEL_BASE        = '/lib/cv/models';
    const LOCAL_MODELS = {
        cocoSsd:            `${MODEL_BASE}/coco-ssd-lite-mobilenet-v2/model.json`,
        movenetLightning:   `${MODEL_BASE}/movenet-lightning/model.json`,
        movenetThunder:     `${MODEL_BASE}/movenet-thunder/model.json`,
        handDetectorLite:   `${MODEL_BASE}/hand-detector-lite/model.json`,
        handDetectorFull:   `${MODEL_BASE}/hand-detector-full/model.json`,
        handLandmarkLite:   `${MODEL_BASE}/hand-landmark-lite/model.json`,
        handLandmarkFull:   `${MODEL_BASE}/hand-landmark-full/model.json`,
        faceDetectionShort: `${MODEL_BASE}/face-detection-short/model.json`,
        faceMesh:           `${MODEL_BASE}/face-mesh/model.json`,
        faceAttentionMesh:  `${MODEL_BASE}/face-attention-mesh/model.json`,
        bodyPix:            `${MODEL_BASE}/bodypix-mobilenet-075-s16-q2/model.json`,
        arPortraitDepth:    `${MODEL_BASE}/ar-portrait-depth/model.json`,
        selfieSegGeneral:   `${MODEL_BASE}/selfie-segmentation-general/model.json`,
    };
    const DEPENDENCY_SCRIPTS = [
        ['TensorFlow.js', 'tfjs', '/lib/cv/tf/tf.min.js'],
        ['COCO-SSD library', 'coco-ssd', '/lib/cv/tf/coco-ssd.min.js'],
        ['Pose Detection library', 'pose-detection', '/lib/cv/tf/pose-detection.min.js'],
        ['Hand Pose library', 'hand-pose-detection', '/lib/cv/tf/hand-pose-detection.min.js'],
        ['BodyPix library', 'body-pix', '/lib/cv/tf/body-pix.min.js'],
        ['Body Segmentation library', 'body-segmentation', '/lib/cv/tf/body-segmentation.min.js'],
        ['Face Landmarks library', 'face-landmarks-detection', '/lib/cv/tf/face-landmarks-detection.min.js'],
        ['Depth Estimation library', 'depth-estimation', '/lib/cv/tf/depth-estimation.min.js'],
        ['Face API library', 'face-api', '/lib/cv/face-api/face-api.js'],
    ];

    let _video      = null;
    let _canvas     = null;
    let _tempCanvas = null;
    let _tempCtx    = null;
    let _running    = false;
    let _animId     = null;
    let _openCvLoadPromise = null;
    let _preloadPromise = null;

    let _algorithm = 'passthrough';
    let _params    = {};
    let _mirror    = false;
    let _paused    = false;
    let _showFps   = false;

    let _objTemplate = null;   // RGBA Mat captured by the user for object detection

    let _fps        = 0;
    let _frameCount = 0;
    let _lastFpsTime = 0;

    function drawStatus(dst, msg) {
        cv.putText(dst, msg, new cv.Point(12, 36),
            cv.FONT_HERSHEY_SIMPLEX, 0.8, new cv.Scalar(57, 255, 20, 255), 2);
    }

    const _preloaders = [{
        label: 'TensorFlow runtime',
        load: async () => {
            if (typeof tf === 'undefined') throw new Error('TensorFlow.js failed to load');
            await tf.ready();
        },
    }];

    const algorithms = {

        // ── Basic ─────────────────────────────────────────────────────────────

        passthrough: (src, dst) => {
            src.copyTo(dst);
        },

        grayscale: (src, dst) => {
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
            cv.cvtColor(dst, dst, cv.COLOR_GRAY2RGBA);
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

        blur: (src, dst, p) => {
            let k = Math.max(1, Math.round(p.kernelSize ?? 5));
            if (k % 2 === 0) k++;
            cv.GaussianBlur(src, dst, new cv.Size(k, k), p.sigma ?? 0);
        },

        threshold: (src, dst, p) => {
            const gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.threshold(gray, gray, p.thresh ?? 127, 255, cv.THRESH_BINARY);
            cv.cvtColor(gray, dst, cv.COLOR_GRAY2RGBA);
            gray.delete();
        },

        // ── Edge & Feature ────────────────────────────────────────────────────

        canny: (src, dst, p) => {
            const gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.Canny(gray, gray, p.low ?? 50, p.high ?? 150);
            cv.cvtColor(gray, dst, cv.COLOR_GRAY2RGBA);
            gray.delete();
        },

        houghLines: (src, dst, p) => {
            const threshold = Math.round(p.threshold ?? 80);
            const minLength = p.minLength ?? 50;
            const maxGap    = p.maxGap    ?? 10;

            const gray  = new cv.Mat();
            const edges = new cv.Mat();
            const lines = new cv.Mat();
            try {
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                cv.Canny(gray, edges, 50, 150);
                cv.HoughLinesP(edges, lines, 1, Math.PI / 180, threshold, minLength, maxGap);

                src.copyTo(dst);
                for (let i = 0; i < lines.rows; i++) {
                    const d = lines.data32S;
                    cv.line(dst,
                        new cv.Point(d[i * 4],     d[i * 4 + 1]),
                        new cv.Point(d[i * 4 + 2], d[i * 4 + 3]),
                        new cv.Scalar(57, 255, 20, 255), 2);
                }
            } finally {
                gray.delete(); edges.delete(); lines.delete();
            }
        },

        houghCircles: (src, dst, p) => {
            const minDist   = p.minDist   ?? 50;
            const param1    = p.param1    ?? 200;
            const param2    = p.param2    ?? 30;
            const minRadius = Math.round(p.minRadius ?? 0);
            const maxRadius = Math.round(p.maxRadius ?? 0);

            const gray    = new cv.Mat();
            const circles = new cv.Mat();
            try {
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                cv.GaussianBlur(gray, gray, new cv.Size(9, 9), 2);
                cv.HoughCircles(gray, circles, cv.HOUGH_GRADIENT,
                    1, minDist, param1, param2, minRadius, maxRadius);

                src.copyTo(dst);
                for (let i = 0; i < circles.cols; i++) {
                    const d  = circles.data32F;
                    const cx = Math.round(d[i * 3]);
                    const cy = Math.round(d[i * 3 + 1]);
                    const r  = Math.round(d[i * 3 + 2]);
                    cv.circle(dst, new cv.Point(cx, cy), r,
                        new cv.Scalar(57, 255, 20, 255), 2);
                    cv.circle(dst, new cv.Point(cx, cy), 3,
                        new cv.Scalar(255, 100, 20, 255), -1);
                }
            } finally {
                gray.delete(); circles.delete();
            }
        },

        harrisCorner: (src, dst, p) => {
            const blockSize = Math.max(2, Math.round(p.blockSize ?? 3));
            let   ksize     = Math.max(3, Math.round(p.ksize    ?? 3));
            if (ksize % 2 === 0) ksize++;
            const k      = p.k         ?? 0.04;
            const thresh = p.threshold ?? 150;

            const gray    = new cv.Mat();
            const corners = new cv.Mat();
            const norm    = new cv.Mat();
            try {
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                cv.cornerHarris(gray, corners, blockSize, ksize, k);
                cv.normalize(corners, norm, 0, 255, cv.NORM_MINMAX, cv.CV_32F);

                src.copyTo(dst);
                const data = norm.data32F;
                for (let r = 0; r < norm.rows; r++) {
                    for (let c = 0; c < norm.cols; c++) {
                        if (data[r * norm.cols + c] > thresh) {
                            cv.circle(dst, new cv.Point(c, r), 4,
                                new cv.Scalar(57, 255, 20, 255), 2);
                        }
                    }
                }
            } finally {
                gray.delete(); corners.delete(); norm.delete();
            }
        },

        // ── Tracking ──────────────────────────────────────────────────────────

        colorDetect: (() => {
            let _cachedH = 0, _lastR = -1, _lastG = -1, _lastB = -1;
            let _ex = 0, _ey = 0, _ew = 0, _eh = 0, _emaReady = false;

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
                    const drawAngle = _mirror ? -bestAngle : bestAngle;
                    const rad = drawAngle * Math.PI / 180;
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

        // ── AI / ML ───────────────────────────────────────────────────────────

        handTrack: (() => {
            let _detector      = null;
            let _loading       = false;
            let _loadError     = null;
            let _inferring     = false;
            let _lastHands     = [];
            let _inferCanvas   = null;
            let _modelLite     = null;  // null=unloaded, false=full, true=lite
            let _modelMaxHands = null;

            const EDGES = [
                [0,1],[0,5],[0,17],[5,9],[9,13],[13,17],  // palm
                [1,2],[2,3],[3,4],                         // thumb
                [5,6],[6,7],[7,8],                         // index
                [9,10],[10,11],[11,12],                    // middle
                [13,14],[14,15],[15,16],                   // ring
                [17,18],[18,19],[19,20],                   // pinky
            ];

            async function tryInit(useLite, maxHands) {
                if (_loading) return;
                if (_detector && _modelLite === useLite && _modelMaxHands === maxHands) return;
                if (typeof handPoseDetection === 'undefined') return;

                if (_detector) {
                    try { _detector.dispose(); } catch {}
                    _detector = null;
                }
                _loading   = true;
                _loadError = null;
                _lastHands = [];
                try {
                    _detector = await handPoseDetection.createDetector(
                        handPoseDetection.SupportedModels.MediaPipeHands,
                        {
                            runtime: 'tfjs',
                            modelType: useLite ? 'lite' : 'full',
                            maxHands,
                            detectorModelUrl: useLite
                                ? LOCAL_MODELS.handDetectorLite
                                : LOCAL_MODELS.handDetectorFull,
                            landmarkModelUrl: useLite
                                ? LOCAL_MODELS.handLandmarkLite
                                : LOCAL_MODELS.handLandmarkFull,
                        }
                    );
                    _modelLite     = useLite;
                    _modelMaxHands = maxHands;
                } catch(e) {
                    console.error('[handtrack]', e);
                    _loadError = e.message ?? String(e);
                }
                _loading = false;
            }

            _preloaders.push({
                label: 'Hand tracking models',
                load: async () => {
                    await tryInit(true, 2);
                    if (!_detector) throw new Error(_loadError || 'Hand tracking Lite model failed to load');
                    await tryInit(false, 2);
                    if (!_detector) throw new Error(_loadError || 'Hand tracking Full model failed to load');
                },
            });

            return (src, dst, p) => {
                src.copyTo(dst);
                const confThresh = p.confThresh ?? 0.5;
                const useLite    = Math.round(p.lite     ?? 0) === 1;
                const maxHands   = Math.max(1, Math.min(4, Math.round(p.maxHands ?? 2)));

                if (_loadError) { drawStatus(dst, `HandTrack: ${_loadError.slice(0, 50)}`); return; }

                if (!_detector || _modelLite !== useLite || _modelMaxHands !== maxHands) {
                    tryInit(useLite, maxHands);
                    drawStatus(dst, _loading ? `Loading MediaPipe ${useLite ? 'Lite' : 'Full'}...` : 'Initializing...');
                    return;
                }

                if (_inferring && _lastHands.length === 0) drawStatus(dst, 'Running inference...');

                for (const hand of _lastHands) {
                    const kps       = hand.keypoints;
                    const isRight   = hand.handedness === 'Right';
                    const lineColor = isRight
                        ? new cv.Scalar(57, 255, 20, 255)
                        : new cv.Scalar(0, 220, 255, 255);
                    const dotColor  = isRight
                        ? new cv.Scalar(255, 100, 20, 255)
                        : new cv.Scalar(255, 255, 80, 255);

                    for (const [a, b] of EDGES) {
                        const ka = kps[a], kb = kps[b];
                        if ((ka.score ?? 1) >= confThresh && (kb.score ?? 1) >= confThresh) {
                            cv.line(dst,
                                new cv.Point(Math.round(ka.x), Math.round(ka.y)),
                                new cv.Point(Math.round(kb.x), Math.round(kb.y)),
                                lineColor, 2);
                        }
                    }
                    for (const kp of kps) {
                        if ((kp.score ?? 1) >= confThresh) {
                            cv.circle(dst,
                                new cv.Point(Math.round(kp.x), Math.round(kp.y)),
                                4, dotColor, -1);
                        }
                    }
                }

                if (!_inferring) {
                    _inferring = true;
                    if (!_inferCanvas ||
                        _inferCanvas.width  !== src.cols ||
                        _inferCanvas.height !== src.rows) {
                        _inferCanvas        = document.createElement('canvas');
                        _inferCanvas.width  = src.cols;
                        _inferCanvas.height = src.rows;
                    }
                    cv.imshow(_inferCanvas, src);
                    _detector.estimateHands(_inferCanvas)
                        .then(hands => { _lastHands = hands; })
                        .catch(e => console.warn('[handtrack]', e))
                        .finally(() => { _inferring = false; });
                }
            };
        })(),

        poseEstimate: (() => {
            let _detector     = null;
            let _loading      = false;
            let _loadError    = null;
            let _inferring    = false;
            let _lastPoses    = [];
            let _inferCanvas  = null;
            let _modelThunder = null; // false=lightning, true=thunder, null=unloaded

            const EDGES = [
                [0,1],[0,2],[1,3],[2,4],
                [5,6],[5,7],[7,9],[6,8],[8,10],
                [5,11],[6,12],[11,12],
                [11,13],[13,15],[12,14],[14,16],
            ];

            async function tryInit(useThunder) {
                if (_loading) return;
                if (_detector && _modelThunder === useThunder) return;
                if (typeof poseDetection === 'undefined') return;

                if (_detector) {
                    try { _detector.dispose(); } catch {}
                    _detector = null;
                }
                _loading   = true;
                _loadError = null;
                _lastPoses = [];
                try {
                    const modelType = useThunder
                        ? poseDetection.movenet.modelType.SINGLEPOSE_THUNDER
                        : poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING;
                    _detector = await poseDetection.createDetector(
                        poseDetection.SupportedModels.MoveNet,
                        {
                            modelType,
                            modelUrl: useThunder
                                ? LOCAL_MODELS.movenetThunder
                                : LOCAL_MODELS.movenetLightning,
                        }
                    );
                    _modelThunder = useThunder;
                } catch(e) {
                    console.error('[movenet]', e);
                    _loadError = e.message ?? String(e);
                }
                _loading = false;
            }

            _preloaders.push({
                label: 'Pose estimation models',
                load: async () => {
                    await tryInit(true);
                    if (!_detector) throw new Error(_loadError || 'MoveNet Thunder failed to load');
                    await tryInit(false);
                    if (!_detector) throw new Error(_loadError || 'MoveNet Lightning failed to load');
                },
            });

            return (src, dst, p) => {
                src.copyTo(dst);
                const confThresh = p.confThresh ?? 0.3;
                const useThunder = Math.round(p.thunder ?? 0) === 1;

                if (_loadError) { drawStatus(dst, `MoveNet: ${_loadError.slice(0, 50)}`); return; }

                if (!_detector || _modelThunder !== useThunder) {
                    tryInit(useThunder);
                    drawStatus(dst, _loading ? `Loading MoveNet ${useThunder ? 'Thunder' : 'Lightning'}...` : 'Initializing...');
                    return;
                }

                if (_inferring && _lastPoses.length === 0) drawStatus(dst, 'Running inference...');

                for (const pose of _lastPoses) {
                    const kps = pose.keypoints;
                    for (const [a, b] of EDGES) {
                        const ka = kps[a], kb = kps[b];
                        if ((ka.score ?? 0) >= confThresh && (kb.score ?? 0) >= confThresh) {
                            cv.line(dst,
                                new cv.Point(Math.round(ka.x), Math.round(ka.y)),
                                new cv.Point(Math.round(kb.x), Math.round(kb.y)),
                                new cv.Scalar(57, 255, 20, 255), 2);
                        }
                    }
                    for (const kp of kps) {
                        if ((kp.score ?? 0) >= confThresh) {
                            cv.circle(dst,
                                new cv.Point(Math.round(kp.x), Math.round(kp.y)),
                                5, new cv.Scalar(255, 100, 20, 255), -1);
                        }
                    }
                }

                if (!_inferring) {
                    _inferring = true;
                    if (!_inferCanvas ||
                        _inferCanvas.width  !== src.cols ||
                        _inferCanvas.height !== src.rows) {
                        _inferCanvas        = document.createElement('canvas');
                        _inferCanvas.width  = src.cols;
                        _inferCanvas.height = src.rows;
                    }
                    cv.imshow(_inferCanvas, src);
                    _detector.estimatePoses(_inferCanvas)
                        .then(poses => { _lastPoses = poses; })
                        .catch(e => console.warn('[movenet]', e))
                        .finally(() => { _inferring = false; });
                }
            };
        })(),

        cocoSsd: (() => {
            let _model       = null;
            let _loading     = false;
            let _inferring   = false;
            let _lastDets    = [];
            let _loadError   = null;
            let _inferCanvas = null;

            async function tryInit() {
                if (_model || _loading || typeof cocoSsd === 'undefined') return;
                _loading   = true;
                _loadError = null;
                try {
                    _model = await cocoSsd.load({
                        modelUrl: LOCAL_MODELS.cocoSsd,
                    });
                } catch(e) {
                    console.error('[coco-ssd]', e);
                    _loadError = e.message ?? String(e);
                }
                _loading = false;
            }

            _preloaders.push({
                label: 'COCO-SSD model',
                load: async () => {
                    await tryInit();
                    if (!_model) throw new Error(_loadError || 'COCO-SSD failed to load');
                },
            });

            return (src, dst, p) => {
                src.copyTo(dst);

                if (_loadError) { drawStatus(dst, `COCO-SSD: ${_loadError.slice(0, 50)}`); return; }
                if (!_model) {
                    tryInit();
                    drawStatus(dst, _loading ? 'Loading COCO-SSD model...' : 'Initializing...');
                    return;
                }

                if (_inferring && _lastDets.length === 0) drawStatus(dst, 'Running inference...');

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

                if (!_inferring) {
                    _inferring = true;
                    if (!_inferCanvas ||
                        _inferCanvas.width  !== src.cols ||
                        _inferCanvas.height !== src.rows) {
                        _inferCanvas        = document.createElement('canvas');
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
            let _emaFaces   = [];

            async function tryInit() {
                if (_classifier || _loading) return;
                _loading = true;
                try {
                    const response = await fetch('/data/haarcascade_frontalface_default.xml');
                    if (!response.ok) throw new Error(`Haar cascade download failed (${response.status})`);
                    const buf = await response.arrayBuffer();
                    try { cv.FS_unlink('face.xml'); } catch { /* first run */ }
                    cv.FS_createDataFile('/', 'face.xml', new Uint8Array(buf), true, false, false);
                    const c = new cv.CascadeClassifier();
                    c.load('face.xml');
                    _classifier = c;
                } finally {
                    _loading = false;
                }
            }

            _preloaders.push({
                label: 'Face detection cascade',
                load: async () => {
                    await tryInit();
                    if (!_classifier) throw new Error('Face detection cascade failed to load');
                },
            });

            return (src, dst, p) => {
                src.copyTo(dst);
                if (!_classifier) {
                    tryInit().catch(e => console.warn('[face-detect]', e));
                    return;
                }

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

        faceLandmarks: (() => {
            let _detector      = null;
            let _loading       = false;
            let _loadError     = null;
            let _inferring     = false;
            let _lastFaces     = [];
            let _inferCanvas   = null;
            let _modelRefine   = null;
            let _modelMaxFaces = null;

            // Closed-loop contours (last point connects back to first)
            const CLOSED = {
                faceOval:  [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109],
                leftEye:   [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246],
                rightEye:  [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466],
                lipsOuter: [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146],
                lipsInner: [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95],
            };

            // Open polyline contours
            const OPEN = {
                leftEyebrow:  [46,53,52,65,55,70,63,105,66,107],
                rightEyebrow: [276,283,282,295,285,300,293,334,296,336],
                noseBridge:   [168,6,197,195,5,4],
                noseTip:      [64,98,97,2,326,327,294],
            };

            const COLORS = {
                faceOval:     [ 57, 255,  20],
                leftEye:      [ 57, 255,  20],
                rightEye:     [ 57, 255,  20],
                lipsOuter:    [255,  80, 150],
                lipsInner:    [255,  80, 150],
                leftEyebrow:  [  0, 220, 255],
                rightEyebrow: [  0, 220, 255],
                noseBridge:   [255, 150,  20],
                noseTip:      [255, 150,  20],
            };

            async function tryInit(refine, maxFaces) {
                if (_loading) return;
                if (_detector && _modelRefine === refine && _modelMaxFaces === maxFaces) return;
                if (typeof faceLandmarksDetection === 'undefined') return;

                if (_detector) {
                    try { _detector.dispose(); } catch {}
                    _detector = null;
                }
                _loading    = true;
                _loadError  = null;
                _lastFaces  = [];
                try {
                    _detector = await faceLandmarksDetection.createDetector(
                        faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
                        {
                            runtime: 'tfjs',
                            refineLandmarks: refine,
                            maxFaces,
                            detectorModelUrl: LOCAL_MODELS.faceDetectionShort,
                            landmarkModelUrl: refine
                                ? LOCAL_MODELS.faceAttentionMesh
                                : LOCAL_MODELS.faceMesh,
                        }
                    );
                    _modelRefine   = refine;
                    _modelMaxFaces = maxFaces;
                } catch(e) {
                    console.error('[facemesh]', e);
                    _loadError = e.message ?? String(e);
                }
                _loading = false;
            }

            _preloaders.push({
                label: 'Face landmark models',
                load: async () => {
                    await tryInit(true, 1);
                    if (!_detector) throw new Error(_loadError || 'Refined Face Mesh failed to load');
                    await tryInit(false, 1);
                    if (!_detector) throw new Error(_loadError || 'Face Mesh failed to load');
                },
            });

            function drawContour(dst, kps, indices, color, closed) {
                const scalar = new cv.Scalar(color[0], color[1], color[2], 255);
                for (let i = 0; i < indices.length - 1; i++) {
                    const a = kps[indices[i]], b = kps[indices[i + 1]];
                    if (!a || !b) continue;
                    cv.line(dst,
                        new cv.Point(Math.round(a.x), Math.round(a.y)),
                        new cv.Point(Math.round(b.x), Math.round(b.y)),
                        scalar, 1);
                }
                if (closed && indices.length > 1) {
                    const first = kps[indices[0]], last = kps[indices[indices.length - 1]];
                    if (first && last)
                        cv.line(dst,
                            new cv.Point(Math.round(last.x),  Math.round(last.y)),
                            new cv.Point(Math.round(first.x), Math.round(first.y)),
                            scalar, 1);
                }
            }

            return (src, dst, p) => {
                src.copyTo(dst);
                const refine   = Math.round(p.refine   ?? 0) === 1;
                const maxFaces = Math.max(1, Math.min(4, Math.round(p.maxFaces ?? 1)));

                if (_loadError) { drawStatus(dst, `FaceMesh: ${_loadError.slice(0, 50)}`); return; }

                if (!_detector || _modelRefine !== refine || _modelMaxFaces !== maxFaces) {
                    tryInit(refine, maxFaces);
                    drawStatus(dst, _loading ? 'Loading Face Mesh model...' : 'Initializing...');
                    return;
                }

                if (_inferring && _lastFaces.length === 0) drawStatus(dst, 'Running inference...');

                for (const face of _lastFaces) {
                    const kps = face.keypoints;

                    for (const [name, idx] of Object.entries(CLOSED))
                        drawContour(dst, kps, idx, COLORS[name], true);
                    for (const [name, idx] of Object.entries(OPEN))
                        drawContour(dst, kps, idx, COLORS[name], false);

                    // Iris rings — only available when refineLandmarks is on (points 468-477)
                    if (refine && kps.length >= 478) {
                        const irisColor = new cv.Scalar(0, 180, 255, 255);
                        for (const ring of [[469,470,471,472], [474,475,476,477]]) {
                            for (let i = 0; i < ring.length; i++) {
                                const a = kps[ring[i]], b = kps[ring[(i + 1) % ring.length]];
                                if (a && b)
                                    cv.line(dst,
                                        new cv.Point(Math.round(a.x), Math.round(a.y)),
                                        new cv.Point(Math.round(b.x), Math.round(b.y)),
                                        irisColor, 1);
                            }
                        }
                    }
                }

                if (!_inferring) {
                    _inferring = true;
                    if (!_inferCanvas ||
                        _inferCanvas.width  !== src.cols ||
                        _inferCanvas.height !== src.rows) {
                        _inferCanvas        = document.createElement('canvas');
                        _inferCanvas.width  = src.cols;
                        _inferCanvas.height = src.rows;
                    }
                    cv.imshow(_inferCanvas, src);
                    _detector.estimateFaces(_inferCanvas)
                        .then(faces => { _lastFaces = faces; })
                        .catch(e => console.warn('[facemesh]', e))
                        .finally(() => { _inferring = false; });
                }
            };
        })(),

        bodySegment: (() => {
            let _net         = null;
            let _loading     = false;
            let _loadError   = null;
            let _inferring   = false;
            let _lastSeg     = null;
            let _inferCanvas = null;

            // [R, G, B] per body-part index 0-23
            const PART_COLORS = [
                [255,  80,  80], [255,  80,  80],  //  0-1:  face
                [ 80, 130, 255], [ 80, 130, 255],  //  2-3:  left upper arm
                [160,  80, 255], [160,  80, 255],  //  4-5:  right upper arm
                [ 80, 200, 255], [ 80, 200, 255],  //  6-7:  left lower arm
                [160, 120, 255], [160, 120, 255],  //  8-9:  right lower arm
                [  0, 230, 255], [  0, 230, 255],  // 10-11: hands
                [ 57, 255,  20], [ 57, 255,  20],  // 12-13: torso
                [255, 180,  50], [255, 180,  50],  // 14-15: left upper leg
                [255, 130,  80], [255, 130,  80],  // 16-17: right upper leg
                [255, 220,  60], [255, 220,  60],  // 18-19: left lower leg
                [255, 170,  60], [255, 170,  60],  // 20-21: right lower leg
                [255, 255,   0], [255, 255,   0],  // 22-23: feet
            ];

            async function tryInit() {
                if (_net || _loading || typeof bodyPix === 'undefined') return;
                _loading   = true;
                _loadError = null;
                try {
                    _net = await bodyPix.load({
                        architecture: 'MobileNetV1',
                        outputStride: 16,
                        multiplier: 0.75,
                        quantBytes: 2,
                        modelUrl: LOCAL_MODELS.bodyPix,
                    });
                } catch(e) {
                    console.error('[bodypix]', e);
                    _loadError = e.message ?? String(e);
                }
                _loading = false;
            }

            _preloaders.push({
                label: 'Body segmentation model',
                load: async () => {
                    await tryInit();
                    if (!_net) throw new Error(_loadError || 'BodyPix failed to load');
                },
            });

            return (src, dst, p) => {
                const threshold = p.threshold ?? 0.7;
                const opacity   = p.opacity   ?? 0.6;

                src.copyTo(dst);

                if (_loadError) { drawStatus(dst, `BodyPix: ${_loadError.slice(0, 50)}`); return; }
                if (!_net) {
                    tryInit();
                    drawStatus(dst, _loading ? 'Loading BodyPix model...' : 'Initializing...');
                    return;
                }

                if (_inferring && !_lastSeg) drawStatus(dst, 'Running inference...');

                if (_lastSeg) {
                    const seg     = _lastSeg;
                    const fw      = src.cols, fh = src.rows;
                    const sw      = seg.width, sh = seg.height;
                    const dstData = dst.data;
                    const srcData = src.data;

                    for (let fy = 0; fy < fh; fy++) {
                        const sy = Math.min(sh - 1, Math.round(fy * sh / fh));
                        for (let fx = 0; fx < fw; fx++) {
                            const part = seg.data[sy * sw + Math.min(sw - 1, Math.round(fx * sw / fw))];
                            if (part >= 0) {
                                const j  = (fy * fw + fx) * 4;
                                const [pr, pg, pb] = PART_COLORS[part];
                                dstData[j]     = Math.round(srcData[j]     * (1 - opacity) + pr * opacity);
                                dstData[j + 1] = Math.round(srcData[j + 1] * (1 - opacity) + pg * opacity);
                                dstData[j + 2] = Math.round(srcData[j + 2] * (1 - opacity) + pb * opacity);
                            }
                        }
                    }
                }

                if (!_inferring) {
                    _inferring = true;
                    if (!_inferCanvas ||
                        _inferCanvas.width  !== src.cols ||
                        _inferCanvas.height !== src.rows) {
                        _inferCanvas        = document.createElement('canvas');
                        _inferCanvas.width  = src.cols;
                        _inferCanvas.height = src.rows;
                    }
                    cv.imshow(_inferCanvas, src);
                    _net.segmentPersonParts(_inferCanvas, {
                        flipHorizontal:        false,
                        internalResolution:    'medium',
                        segmentationThreshold: threshold,
                        maxDetections:         5,
                        scoreThreshold:        0.3,
                    })
                        .then(seg => { _lastSeg = seg; })
                        .catch(e => console.warn('[bodypix]', e))
                        .finally(() => { _inferring = false; });
                }
            };
        })(),

        depthEstimate: (() => {
            let _estimator   = null;
            let _loading     = false;
            let _loadError   = null;
            let _inferring   = false;
            let _inferCanvas = null;
            let _outCanvas   = null;

            async function tryInit() {
                if (_estimator || _loading || typeof depthEstimation === 'undefined') return;
                _loading = true; _loadError = null;
                try {
                    _estimator = await depthEstimation.createEstimator(
                        depthEstimation.SupportedModels.ARPortraitDepth,
                        {
                            outputDepthRange: [0, 1],
                            depthModelUrl: LOCAL_MODELS.arPortraitDepth,
                            segmentationModelUrl: LOCAL_MODELS.selfieSegGeneral,
                        }
                    );
                } catch(e) {
                    console.error('[depth]', e);
                    _loadError = e.message ?? String(e);
                }
                _loading = false;
            }

            _preloaders.push({
                label: 'Depth estimation model',
                load: async () => {
                    await tryInit();
                    if (!_estimator) throw new Error(_loadError || 'Depth estimation failed to load');
                },
            });

            function turboColor(t) {
                const stops = [
                    [0.00, [ 30,   0, 150]],
                    [0.25, [  0, 180, 255]],
                    [0.50, [  0, 255,  80]],
                    [0.75, [255, 240,   0]],
                    [1.00, [255,  30,   0]],
                ];
                for (let i = 0; i < stops.length - 1; i++) {
                    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
                    if (t >= t0 && t <= t1) {
                        const f = (t - t0) / (t1 - t0);
                        return [Math.round(c0[0] + f*(c1[0]-c0[0])),
                                Math.round(c0[1] + f*(c1[1]-c0[1])),
                                Math.round(c0[2] + f*(c1[2]-c0[2]))];
                    }
                }
                return stops[stops.length - 1][1];
            }

            return (src, dst, p) => {
                const blend  = p.blend  ?? 0.85;
                const invert = Math.round(p.invert ?? 0) === 1;

                src.copyTo(dst);

                if (_loadError) { drawStatus(dst, `Depth: ${_loadError.slice(0, 50)}`); return; }
                if (!_estimator) {
                    tryInit();
                    drawStatus(dst, _loading ? 'Loading depth model...' : 'Initializing...');
                    return;
                }

                if (_outCanvas && _outCanvas.width > 0) {
                    const depthMat = cv.imread(_outCanvas);
                    const target   = new cv.Mat();
                    try {
                        if (depthMat.cols !== src.cols || depthMat.rows !== src.rows) {
                            cv.resize(depthMat, target, new cv.Size(src.cols, src.rows));
                        } else {
                            depthMat.copyTo(target);
                        }
                        cv.addWeighted(src, 1 - blend, target, blend, 0, dst);
                    } finally {
                        depthMat.delete(); target.delete();
                    }
                }

                if (!_inferring) {
                    _inferring = true;
                    if (!_inferCanvas || _inferCanvas.width !== src.cols || _inferCanvas.height !== src.rows) {
                        _inferCanvas = document.createElement('canvas');
                        _inferCanvas.width = src.cols; _inferCanvas.height = src.rows;
                    }
                    cv.imshow(_inferCanvas, src);

                    _estimator.estimateDepth(_inferCanvas, { minDepth: 0, maxDepth: 1 })
                        .then(async depthMap => {
                            const tensor = depthMap.depthTensor;
                            const data   = await tensor.data();
                            const h = tensor.shape[0], w = tensor.shape[1];

                            // Normalize to [0,1] across frame for maximum visual contrast
                            let mn = Infinity, mx = -Infinity;
                            for (let i = 0; i < data.length; i++) {
                                if (data[i] < mn) mn = data[i];
                                if (data[i] > mx) mx = data[i];
                            }
                            const range = mx - mn || 1;

                            const pixels = new Uint8ClampedArray(w * h * 4);
                            for (let i = 0; i < data.length; i++) {
                                let t = (data[i] - mn) / range;
                                if (invert) t = 1 - t;
                                const [r, g, b] = turboColor(t);
                                const j = i * 4;
                                pixels[j] = r; pixels[j+1] = g; pixels[j+2] = b; pixels[j+3] = 255;
                            }

                            if (!_outCanvas) _outCanvas = document.createElement('canvas');
                            _outCanvas.width = w; _outCanvas.height = h;
                            _outCanvas.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0);
                            tensor.dispose();
                        })
                        .catch(e => console.warn('[depth]', e))
                        .finally(() => { _inferring = false; });
                }
            };
        })(),

        emotionDetect: (() => {
            let _modelsLoaded = false;
            let _loading      = false;
            let _loadError    = null;
            let _inferring    = false;
            let _lastFaces    = [];
            let _inferCanvas  = null;

            const MODEL_URL = FACE_API_WEIGHTS;

            const EMO_COLORS = {
                happy:     [57,  255,  20],
                surprised: [255, 230,   0],
                neutral:   [180, 180, 180],
                sad:       [ 80, 160, 255],
                angry:     [255,  60,  60],
                fearful:   [200,  80, 255],
                disgusted: [255, 140,   0],
            };

            async function tryInit() {
                if (_modelsLoaded || _loading || typeof faceapi === 'undefined') return;
                _loading = true; _loadError = null;
                try {
                    await Promise.all([
                        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
                    ]);
                    _modelsLoaded = true;
                } catch(e) {
                    console.error('[emotion]', e);
                    _loadError = e.message ?? String(e);
                }
                _loading = false;
            }

            function drawFaces(dst, faces) {
                for (const f of faces) {
                    const box = f.detection.box;
                    const x = Math.round(box.x), y = Math.round(box.y);
                    const w = Math.round(box.width), h = Math.round(box.height);

                    const sorted = Object.entries(f.expressions).sort((a, b) => b[1] - a[1]);
                    const [topEmo] = sorted[0];
                    const [cr, cg, cb] = EMO_COLORS[topEmo] ?? [255, 255, 255];

                    // Face box in top-emotion color
                    cv.rectangle(dst, new cv.Point(x, y), new cv.Point(x + w, y + h),
                        new cv.Scalar(cr, cg, cb, 255), 2);

                    // Top 3 emotions as stacked labels below the box
                    for (let i = 0; i < Math.min(3, sorted.length); i++) {
                        const [emo, conf] = sorted[i];
                        const [er, eg, eb] = EMO_COLORS[emo] ?? [200, 200, 200];
                        const ty = y + h + 14 + i * 16;
                        if (ty > dst.rows - 4) break;
                        cv.putText(dst, `${emo}  ${Math.round(conf * 100)}%`,
                            new cv.Point(x, ty),
                            cv.FONT_HERSHEY_SIMPLEX, 0.45,
                            new cv.Scalar(er, eg, eb, 255), 1);
                    }
                }
            }

            _preloaders.push({
                label: 'Emotion detection models',
                load: async () => {
                    await tryInit();
                    if (!_modelsLoaded) throw new Error(_loadError || 'Emotion detection failed to load');
                },
            });

            return (src, dst, p) => {
                const confThresh = p.confThresh ?? 0.5;

                src.copyTo(dst);

                if (_loadError) { drawStatus(dst, `Emotion: ${_loadError.slice(0, 50)}`); return; }
                if (!_modelsLoaded) {
                    tryInit();
                    drawStatus(dst, _loading ? 'Loading emotion models...' : 'Initializing...');
                    return;
                }

                if (_inferring && _lastFaces.length === 0) drawStatus(dst, 'Running inference...');
                if (_lastFaces.length > 0) drawFaces(dst, _lastFaces);

                if (!_inferring) {
                    _inferring = true;
                    if (!_inferCanvas || _inferCanvas.width !== src.cols || _inferCanvas.height !== src.rows) {
                        _inferCanvas = document.createElement('canvas');
                        _inferCanvas.width = src.cols; _inferCanvas.height = src.rows;
                    }
                    cv.imshow(_inferCanvas, src);
                    faceapi
                        .detectAllFaces(_inferCanvas,
                            new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: confThresh }))
                        .withFaceExpressions()
                        .then(faces => { _lastFaces = faces; })
                        .catch(e => console.warn('[emotion]', e))
                        .finally(() => { _inferring = false; });
                }
            };
        })(),

        // ── Motion ────────────────────────────────────────────────────────────

        opticalFlow: (() => {
            let _prevGray = null;
            return (src, dst, p) => {
                const pyrScale   = p.pyrScale   ?? 0.5;
                const levels     = Math.max(1, Math.round(p.levels     ?? 3));
                const winsize    = Math.max(1, Math.round(p.winsize    ?? 15));
                const iterations = Math.max(1, Math.round(p.iterations ?? 3));
                const polySigma  = p.polySigma  ?? 1.2;

                const gray = new cv.Mat();
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

                if (!_prevGray || _prevGray.rows !== gray.rows || _prevGray.cols !== gray.cols) {
                    if (_prevGray) _prevGray.delete();
                    _prevGray = gray.clone();
                    src.copyTo(dst);
                    gray.delete();
                    return;
                }

                const flow    = new cv.Mat();
                const mag     = new cv.Mat();
                const ang     = new cv.Mat();
                const normMag = new cv.Mat();
                const hMat    = new cv.Mat(src.rows, src.cols, cv.CV_8UC1);
                const sMat    = new cv.Mat(src.rows, src.cols, cv.CV_8UC1, new cv.Scalar(255));
                const hsv     = new cv.Mat();
                const bgr     = new cv.Mat();
                try {
                    cv.calcOpticalFlowFarneback(
                        _prevGray, gray, flow,
                        pyrScale, levels, winsize, iterations, 5, polySigma, 0
                    );

                    const flowVec = new cv.MatVector();
                    cv.split(flow, flowVec);
                    const fx = flowVec.get(0);
                    const fy = flowVec.get(1);
                    cv.cartToPolar(fx, fy, mag, ang, true);
                    fx.delete(); fy.delete(); flowVec.delete();

                    cv.normalize(mag, normMag, 0, 255, cv.NORM_MINMAX);

                    const angData = ang.data32F;
                    const hData   = hMat.data;
                    for (let i = 0; i < angData.length; i++) {
                        hData[i] = Math.round(angData[i] * 0.5) % 180;
                    }

                    const vMat = new cv.Mat();
                    normMag.convertTo(vMat, cv.CV_8UC1);

                    const hsvVec = new cv.MatVector();
                    hsvVec.push_back(hMat);
                    hsvVec.push_back(sMat);
                    hsvVec.push_back(vMat);
                    cv.merge(hsvVec, hsv);
                    hsvVec.delete(); vMat.delete();

                    cv.cvtColor(hsv, bgr, cv.COLOR_HSV2BGR);
                    cv.cvtColor(bgr, dst, cv.COLOR_BGR2RGBA);
                } finally {
                    flow.delete(); mag.delete(); ang.delete();
                    normMag.delete(); hMat.delete(); sMat.delete();
                    hsv.delete(); bgr.delete();
                    _prevGray.delete();
                    _prevGray = gray.clone();
                    gray.delete();
                }
            };
        })(),

        frameDiff: (() => {
            let _prevGray = null;
            return (src, dst, p) => {
                let k = Math.max(1, Math.round(p.blur ?? 3));
                if (k % 2 === 0) k++;
                const thresh  = p.threshold ?? 25;
                const dilSize = Math.max(0, Math.round(p.dilate ?? 6));

                const gray = new cv.Mat();
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                if (k > 1) cv.GaussianBlur(gray, gray, new cv.Size(k, k), 0);

                if (!_prevGray || _prevGray.rows !== gray.rows || _prevGray.cols !== gray.cols) {
                    if (_prevGray) _prevGray.delete();
                    _prevGray = gray.clone();
                    src.copyTo(dst);
                    gray.delete();
                    return;
                }

                const diff = new cv.Mat();
                const mask = new cv.Mat();
                try {
                    cv.absdiff(_prevGray, gray, diff);
                    cv.threshold(diff, mask, thresh, 255, cv.THRESH_BINARY);

                    if (dilSize > 0) {
                        const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(dilSize, dilSize));
                        cv.dilate(mask, mask, kernel);
                        kernel.delete();
                    }

                    src.copyTo(dst);
                    const maskData = mask.data;
                    const dstData  = dst.data;
                    for (let i = 0, j = 0; i < maskData.length; i++, j += 4) {
                        if (maskData[i]) {
                            dstData[j]     = Math.round(dstData[j]     * 0.2);
                            dstData[j + 1] = Math.min(255, Math.round(dstData[j + 1] * 0.4 + 180));
                            dstData[j + 2] = Math.round(dstData[j + 2] * 0.2);
                        }
                    }
                } finally {
                    diff.delete(); mask.delete();
                    _prevGray.delete();
                    _prevGray = gray.clone();
                    gray.delete();
                }
            };
        })(),

        bgSubtract: (() => {
            let _bg = null;  // CV_32FC4 running-average background model

            return (src, dst, p) => {
                const history   = Math.max(1, Math.round(p.history ?? 200));
                const varThresh = p.varThreshold ?? 16;
                const shadows   = Math.round(p.shadows ?? 1) === 1;
                const alpha     = 1.0 / history;

                if (!_bg || _bg.rows !== src.rows || _bg.cols !== src.cols) {
                    if (_bg) _bg.delete();
                    _bg = new cv.Mat(src.rows, src.cols, cv.CV_32FC4);
                    src.convertTo(_bg, cv.CV_32FC4);
                }

                // Exponential moving average background update
                const bgF32 = _bg.data32F;
                const srcU8 = src.data;
                const n     = bgF32.length;
                const decay = 1 - alpha;
                for (let i = 0; i < n; i++) {
                    bgF32[i] = bgF32[i] * decay + srcU8[i] * alpha;
                }

                src.copyTo(dst);
                const dstData  = dst.data;
                const pixCount = src.rows * src.cols;

                for (let px = 0, j = 0; px < pixCount; px++, j += 4) {
                    const rS = srcU8[j], gS = srcU8[j + 1], bS = srcU8[j + 2];
                    const rB = bgF32[j], gB = bgF32[j + 1], bB = bgF32[j + 2];
                    const maxDiff = Math.max(Math.abs(rS - rB), Math.abs(gS - gB), Math.abs(bS - bB));

                    if (maxDiff > varThresh) {
                        if (shadows) {
                            const lumS = 0.299 * rS + 0.587 * gS + 0.114 * bS;
                            const lumB = 0.299 * rB + 0.587 * gB + 0.114 * bB;
                            if (lumS < lumB * 0.85 && lumB > 20) {
                                const totS = rS + gS + bS + 1;
                                const totB = rB + gB + bB + 1;
                                const colorDiff = Math.abs(rS / totS - rB / totB)
                                                + Math.abs(gS / totS - gB / totB)
                                                + Math.abs(bS / totS - bB / totB);
                                if (colorDiff < 0.15) {
                                    dstData[j]     = Math.round(dstData[j]     * 0.3);
                                    dstData[j + 1] = Math.round(dstData[j + 1] * 0.3);
                                    dstData[j + 2] = Math.min(255, Math.round(dstData[j + 2] * 0.4 + 140));
                                    continue;
                                }
                            }
                        }
                        // Foreground: green tint
                        dstData[j]     = Math.round(dstData[j]     * 0.2);
                        dstData[j + 1] = Math.min(255, Math.round(dstData[j + 1] * 0.4 + 180));
                        dstData[j + 2] = Math.round(dstData[j + 2] * 0.2);
                    } else {
                        // Background: darken
                        dstData[j]     = Math.round(dstData[j]     * 0.35);
                        dstData[j + 1] = Math.round(dstData[j + 1] * 0.35);
                        dstData[j + 2] = Math.round(dstData[j + 2] * 0.35);
                    }
                }
            };
        })(),

        bgBlur: (() => {
            let _bg = null;

            return (src, dst, p) => {
                const history   = Math.max(1, Math.round(p.history     ?? 200));
                const varThresh = p.sensitivity ?? 16;
                const alpha     = 1.0 / history;
                let   blurK     = Math.max(1, Math.round(p.blur        ?? 21));
                let   featherK  = Math.max(1, Math.round(p.feather     ?? 15));
                if (blurK    % 2 === 0) blurK++;
                if (featherK % 2 === 0) featherK++;

                if (!_bg || _bg.rows !== src.rows || _bg.cols !== src.cols) {
                    if (_bg) _bg.delete();
                    _bg = new cv.Mat(src.rows, src.cols, cv.CV_32FC4);
                    src.convertTo(_bg, cv.CV_32FC4);
                }

                const bgF32    = _bg.data32F;
                const srcU8    = src.data;
                const pixCount = src.rows * src.cols;
                const decay    = 1 - alpha;

                for (let i = 0; i < bgF32.length; i++) {
                    bgF32[i] = bgF32[i] * decay + srcU8[i] * alpha;
                }

                const fgMask  = new cv.Mat(src.rows, src.cols, cv.CV_8UC1);
                const rawMask = fgMask.data;
                for (let px = 0, j = 0; px < pixCount; px++, j += 4) {
                    const maxDiff = Math.max(
                        Math.abs(srcU8[j]     - bgF32[j]),
                        Math.abs(srcU8[j + 1] - bgF32[j + 1]),
                        Math.abs(srcU8[j + 2] - bgF32[j + 2])
                    );
                    rawMask[px] = maxDiff > varThresh ? 255 : 0;
                }

                const blurred  = new cv.Mat();
                const softMask = new cv.Mat();
                try {
                    cv.GaussianBlur(fgMask, softMask, new cv.Size(featherK, featherK), 0);
                    cv.GaussianBlur(src,    blurred,  new cv.Size(blurK,    blurK),    0);

                    src.copyTo(dst);
                    const dstData  = dst.data;
                    const blurData = blurred.data;
                    const mData    = softMask.data;

                    for (let px = 0, j = 0; px < pixCount; px++, j += 4) {
                        const t = mData[px] / 255;
                        dstData[j]     = Math.round(srcU8[j]     * t + blurData[j]     * (1 - t));
                        dstData[j + 1] = Math.round(srcU8[j + 1] * t + blurData[j + 1] * (1 - t));
                        dstData[j + 2] = Math.round(srcU8[j + 2] * t + blurData[j + 2] * (1 - t));
                    }
                } finally {
                    blurred.delete(); softMask.delete(); fgMask.delete();
                }
            };
        })(),

        portraitBlur: (() => {
            let _seg         = null;
            let _loading     = false;
            let _loadError   = null;
            let _inferring   = false;
            let _maskData    = null;  // Float32Array, one value per pixel, person=1
            let _maskW       = 0;
            let _maskH       = 0;
            let _inferCanvas = null;
            let _maskCanvas  = null;
            let _maskCtx     = null;

            async function tryInit() {
                if (_seg || _loading) return;
                _loading   = true;
                _loadError = null;
                try {
                    if (typeof SelfieSegmentation === 'undefined') {
                        await new Promise((resolve, reject) => {
                            const s       = document.createElement('script');
                            s.src         = `${MEDIAPIPE_SELFIE}/selfie_segmentation.js`;
                            s.onload      = resolve;
                            s.onerror     = () => reject(new Error('Failed to load MediaPipe script'));
                            document.head.appendChild(s);
                        });
                    }
                    const seg = new SelfieSegmentation({
                        locateFile: (file) => `${MEDIAPIPE_SELFIE}/${file}`
                    });
                    seg.setOptions({ modelSelection: 1 });
                    seg.onResults((results) => {
                        const mask = results.segmentationMask;
                        if (!_maskCanvas) {
                            _maskCanvas = document.createElement('canvas');
                            _maskCtx    = _maskCanvas.getContext('2d', { willReadFrequently: true });
                        }
                        _maskCanvas.width  = mask.width;
                        _maskCanvas.height = mask.height;
                        _maskCtx.drawImage(mask, 0, 0);
                        const imgData = _maskCtx.getImageData(0, 0, mask.width, mask.height);
                        _maskData = new Float32Array(mask.width * mask.height);
                        for (let i = 0; i < _maskData.length; i++) {
                            _maskData[i] = imgData.data[i * 4] / 255;
                        }
                        _maskW     = mask.width;
                        _maskH     = mask.height;
                        _inferring = false;
                    });
                    await seg.initialize();
                    _seg = seg;
                } catch (e) {
                    console.error('[portrait-blur]', e);
                    _loadError = e.message ?? String(e);
                }
                _loading = false;
            }

            _preloaders.push({
                label: 'MediaPipe portrait model',
                load: async () => {
                    await tryInit();
                    if (!_seg) throw new Error(_loadError || 'MediaPipe portrait model failed to load');
                },
            });

            return (src, dst, p) => {
                let blurK        = Math.max(1, Math.round(p.blur ?? 21));
                if (blurK % 2 === 0) blurK++;
                const featherSig = Math.max(0, p.feather ?? 5);

                src.copyTo(dst);

                if (_loadError) { drawStatus(dst, 'MediaPipe error — see console'); return; }
                if (!_seg) {
                    tryInit();
                    drawStatus(dst, _loading ? 'Loading MediaPipe model...' : 'Initializing...');
                    return;
                }

                if (!_inferring) {
                    _inferring = true;
                    if (!_inferCanvas ||
                        _inferCanvas.width  !== src.cols ||
                        _inferCanvas.height !== src.rows) {
                        _inferCanvas        = document.createElement('canvas');
                        _inferCanvas.width  = src.cols;
                        _inferCanvas.height = src.rows;
                    }
                    cv.imshow(_inferCanvas, src);
                    _seg.send({ image: _inferCanvas }).catch(e => {
                        console.warn('[portrait-blur]', e);
                        _inferring = false;
                    });
                }

                if (!_maskData) return;

                const iw       = src.cols;
                const ih       = src.rows;
                const fgMat    = new cv.Mat(ih, iw, cv.CV_8UC1);
                const softMask = new cv.Mat();
                const blurred  = new cv.Mat();
                try {
                    // Scale mask to frame size
                    const fgData = fgMat.data;
                    for (let r = 0; r < ih; r++) {
                        const mr = Math.min(_maskH - 1, Math.round(r * _maskH / ih));
                        for (let c = 0; c < iw; c++) {
                            const mc = Math.min(_maskW - 1, Math.round(c * _maskW / iw));
                            fgData[r * iw + c] = Math.round(_maskData[mr * _maskW + mc] * 255);
                        }
                    }

                    if (featherSig > 0)
                        cv.GaussianBlur(fgMat, softMask, new cv.Size(0, 0), featherSig);
                    else
                        fgMat.copyTo(softMask);
                    cv.GaussianBlur(src, blurred, new cv.Size(blurK, blurK), 0);

                    const srcU8    = src.data;
                    const dstData  = dst.data;
                    const blurData = blurred.data;
                    const smData   = softMask.data;
                    const pixCount = iw * ih;

                    for (let px = 0, j = 0; px < pixCount; px++, j += 4) {
                        const t = smData[px] / 255;
                        dstData[j]     = Math.round(srcU8[j]     * t + blurData[j]     * (1 - t));
                        dstData[j + 1] = Math.round(srcU8[j + 1] * t + blurData[j + 1] * (1 - t));
                        dstData[j + 2] = Math.round(srcU8[j + 2] * t + blurData[j + 2] * (1 - t));
                    }
                } finally {
                    fgMat.delete(); softMask.delete(); blurred.delete();
                }
            };
        })(),

        // ── Stylize ───────────────────────────────────────────────────────────

        pencilSketch: (src, dst, p) => {
            let k = Math.max(1, Math.round(p.blur ?? 21));
            if (k % 2 === 0) k++;
            const sigma  = p.sigma  ?? 0;
            const invert = Math.round(p.invert ?? 0) === 1;

            const gray    = new cv.Mat();
            const inv     = new cv.Mat();
            const blurred = new cv.Mat();
            const divisor = new cv.Mat();
            const sketch  = new cv.Mat();
            try {
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                cv.bitwise_not(gray, inv);
                cv.GaussianBlur(inv, blurred, new cv.Size(k, k), sigma);
                cv.bitwise_not(blurred, divisor);
                cv.divide(gray, divisor, sketch, 255);
                if (invert) cv.bitwise_not(sketch, sketch);
                cv.cvtColor(sketch, dst, cv.COLOR_GRAY2RGBA);
            } finally {
                gray.delete(); inv.delete(); blurred.delete();
                divisor.delete(); sketch.delete();
            }
        },

        pixelate: (src, dst, p) => {
            const blockSize = Math.max(2, Math.round(p.blockSize  ?? 16));
            const satScale  = p.saturation ?? 1;

            const w  = src.cols;
            const h  = src.rows;
            const sw = Math.max(1, Math.round(w / blockSize));
            const sh = Math.max(1, Math.round(h / blockSize));

            let base = new cv.Mat();
            if (Math.abs(satScale - 1) > 0.005) {
                const bgr = new cv.Mat();
                const hsv = new cv.Mat();
                cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);
                cv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV);
                bgr.delete();

                const vec = new cv.MatVector();
                cv.split(hsv, vec);
                const hCh = vec.get(0), sCh = vec.get(1), vCh = vec.get(2);
                cv.convertScaleAbs(sCh, sCh, satScale, 0);
                cv.merge(vec, hsv);
                hCh.delete(); sCh.delete(); vCh.delete(); vec.delete();

                const bgrOut = new cv.Mat();
                cv.cvtColor(hsv, bgrOut, cv.COLOR_HSV2BGR);
                hsv.delete();
                cv.cvtColor(bgrOut, base, cv.COLOR_BGR2RGBA);
                bgrOut.delete();
            } else {
                src.copyTo(base);
            }

            const small = new cv.Mat();
            try {
                cv.resize(base, small, new cv.Size(sw, sh), 0, 0, cv.INTER_NEAREST);
                cv.resize(small, dst,  new cv.Size(w,  h),  0, 0, cv.INTER_NEAREST);
            } finally {
                small.delete();
                base.delete();
            }
        },

        cartoon: (src, dst, p) => {
            const passes = Math.max(1, Math.round(p.passes     ?? 3));
            const sigma  = p.sigmaColor ?? 75;
            let   eb     = Math.max(3, Math.round(p.edgeBlock  ?? 9));
            if (eb % 2 === 0) eb++;
            const edgeC  = p.edgeC ?? 7;

            const bgr = new cv.Mat();
            cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);

            let cur  = bgr.clone();
            const tmp = new cv.Mat();
            for (let i = 0; i < passes; i++) {
                cv.bilateralFilter(cur, tmp, 9, sigma, sigma);
                tmp.copyTo(cur);
            }
            tmp.delete(); bgr.delete();

            const gray  = new cv.Mat();
            const edges = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.medianBlur(gray, gray, 5);
            cv.adaptiveThreshold(gray, edges, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, eb, edgeC);
            gray.delete();

            const edgesBGR = new cv.Mat();
            cv.cvtColor(edges, edgesBGR, cv.COLOR_GRAY2BGR);
            edges.delete();
            cv.bitwise_and(cur, edgesBGR, cur);
            edgesBGR.delete();

            cv.cvtColor(cur, dst, cv.COLOR_BGR2RGBA);
            cur.delete();
        },

        kaleidoscope: (() => {
            let _autoRot  = 0;
            let _lastTime = 0;

            return (src, dst, p) => {
                const manualRot = p.rotation ?? 0;
                const cycle     = Math.round(p.cycle ?? 0) === 1;
                const speed     = p.speed ?? 2;
                const w = src.cols, h = src.rows;
                const hw = Math.floor(w / 2), hh = Math.floor(h / 2);

                let rotation;
                const now = performance.now();
                if (cycle) {
                    if (_lastTime > 0) _autoRot = (_autoRot + speed * 36 * (now - _lastTime) / 1000) % 360;
                    _lastTime = now;
                    rotation  = _autoRot;
                } else {
                    _autoRot  = manualRot;
                    _lastTime = 0;
                    rotation  = manualRot;
                }

                let base = src, rotated = null;
                if (Math.abs(rotation) > 0.5) {
                    rotated = new cv.Mat();
                    const M = cv.getRotationMatrix2D(new cv.Point(w / 2, h / 2), rotation, 1);
                    cv.warpAffine(src, rotated, M, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REFLECT);
                    M.delete();
                    base = rotated;
                }

                base.copyTo(dst);
                const srcData = base.data;
                const dstData = dst.data;

                for (let r = 0; r < hh; r++) {
                    for (let c = 0; c < hw; c++) {
                        const si = (r * w + c) * 4;
                        const R = srcData[si], G = srcData[si+1], B = srcData[si+2], A = srcData[si+3];

                        const ti  = (r * w + (w - 1 - c)) * 4;
                        dstData[ti] = R; dstData[ti+1] = G; dstData[ti+2] = B; dstData[ti+3] = A;

                        const bli = ((h - 1 - r) * w + c) * 4;
                        dstData[bli] = R; dstData[bli+1] = G; dstData[bli+2] = B; dstData[bli+3] = A;

                        const bri = ((h - 1 - r) * w + (w - 1 - c)) * 4;
                        dstData[bri] = R; dstData[bri+1] = G; dstData[bri+2] = B; dstData[bri+3] = A;
                    }
                }

                if (rotated) rotated.delete();
            };
        })(),

        asciiArt: (() => {
            let _offCanvas = null;
            let _offCtx    = null;
            // Ordered lightest to densest; space = invisible, @ = maximum ink
            const CHARS = ' .,:;i=+*#%@';

            return (src, dst, p) => {
                const cellSize = Math.max(4, Math.round(p.cellSize ?? 8));
                const colored  = Math.round(p.colored ?? 0) === 1;
                const w = src.cols, h = src.rows;
                const cols = Math.floor(w / cellSize);
                const rows = Math.floor(h / cellSize);

                if (!_offCanvas || _offCanvas.width !== w || _offCanvas.height !== h) {
                    _offCanvas        = document.createElement('canvas');
                    _offCanvas.width  = w;
                    _offCanvas.height = h;
                    _offCtx = _offCanvas.getContext('2d', { willReadFrequently: true });
                }

                const srcData = src.data;
                _offCtx.fillStyle = '#000';
                _offCtx.fillRect(0, 0, w, h);
                _offCtx.font         = `bold ${cellSize}px monospace`;
                _offCtx.textBaseline = 'top';

                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        // Average a small cross-sample within the cell for better accuracy
                        let sumR = 0, sumG = 0, sumB = 0, count = 0;
                        for (let sy = 0; sy < 3; sy++) {
                            for (let sx = 0; sx < 3; sx++) {
                                const px = Math.min(w - 1, col * cellSize + Math.round((sx + 0.5) * cellSize / 3));
                                const py = Math.min(h - 1, row * cellSize + Math.round((sy + 0.5) * cellSize / 3));
                                const idx = (py * w + px) * 4;
                                sumR += srcData[idx]; sumG += srcData[idx+1]; sumB += srcData[idx+2];
                                count++;
                            }
                        }
                        const r = sumR / count, g = sumG / count, b = sumB / count;
                        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                        const ch  = CHARS[Math.min(CHARS.length - 1, Math.floor(lum / 256 * CHARS.length))];
                        // Non-colored: phosphor green at full brightness — density creates the greyscale
                        _offCtx.fillStyle = colored
                            ? `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
                            : '#39ff14';
                        _offCtx.fillText(ch, col * cellSize, row * cellSize);
                    }
                }

                const result = cv.imread(_offCanvas);
                result.copyTo(dst);
                result.delete();
            };
        })(),

        nightVision: (src, dst, p) => {
            const amplify  = p.amplify  ?? 2.5;
            const grainAmt = p.grain    ?? 30;
            const vigStr   = p.vignette ?? 0.7;
            const w = src.cols, h = src.rows;
            const gray = new cv.Mat();
            try {
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                src.copyTo(dst);
                const grayData = gray.data;
                const dstData  = dst.data;
                const cx = w / 2, cy = h / 2;
                const maxDist2 = cx * cx + cy * cy;

                for (let r = 0; r < h; r++) {
                    for (let c = 0; c < w; c++) {
                        const i = r * w + c;
                        const j = i * 4;
                        let v = Math.min(255, Math.round(grayData[i] * amplify));
                        if (grainAmt > 0)
                            v = Math.max(0, Math.min(255, v + Math.round((Math.random() - 0.5) * grainAmt)));
                        const dx = c - cx, dy = r - cy;
                        const vig = Math.max(0, 1 - vigStr * (dx * dx + dy * dy) / maxDist2);
                        v = Math.round(v * vig);
                        dstData[j]     = Math.round(v * 0.1);
                        dstData[j + 1] = v;
                        dstData[j + 2] = Math.round(v * 0.15);
                        dstData[j + 3] = 255;
                    }
                }
            } finally {
                gray.delete();
            }
        },

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

    function withTimeout(promise, timeoutMs, message) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            Promise.resolve(promise).then(
                value => { clearTimeout(timer); resolve(value); },
                error => { clearTimeout(timer); reject(error); }
            );
        });
    }

    async function waitForOpenCvRuntime(timeoutMs = 30000) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const candidate = window.cv;
            if (candidate?.Mat) return;

            // Modern OpenCV.js builds can expose the runtime as a Promise.
            if (candidate && typeof candidate.then === 'function') {
                const runtime = await withTimeout(
                    candidate,
                    Math.max(1, deadline - Date.now()),
                    `OpenCV.js runtime timed out after ${timeoutMs / 1000} seconds`
                );

                if (!runtime?.Mat) {
                    throw new Error('OpenCV.js loaded, but its runtime is invalid');
                }

                window.cv = runtime;
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 50));
        }

        throw new Error(`OpenCV.js runtime timed out after ${timeoutMs / 1000} seconds`);
    }

    function injectOpenCvScript() {
        return new Promise((resolve, reject) => {
            const existing = document.getElementById(OPEN_CV_SCRIPT_ID);
            if (existing) {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', () => reject(
                    new Error(`Failed to load OpenCV.js from ${OPEN_CV_URL}`)
                ), { once: true });
                return;
            }

            const script   = document.createElement('script');
            script.id      = OPEN_CV_SCRIPT_ID;
            script.async   = true;
            script.src     = OPEN_CV_URL;
            script.onload  = resolve;
            script.onerror = () => reject(
                new Error(`Failed to load OpenCV.js from ${OPEN_CV_URL}`)
            );
            document.head.appendChild(script);
        });
    }

    function loadDependencyScript(id, url) {
        return new Promise((resolve, reject) => {
            const scriptId = `cv-dependency-${id}`;
            const existing = document.getElementById(scriptId);
            if (existing?.dataset.ready === 'true') {
                resolve();
                return;
            }
            if (existing) {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', () => reject(
                    new Error(`Failed to load ${url}`)
                ), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.id = scriptId;
            script.src = url;
            script.onload = () => {
                script.dataset.ready = 'true';
                resolve();
            };
            script.onerror = () => {
                script.remove();
                reject(new Error(`Failed to load ${url}`));
            };
            document.head.appendChild(script);
        });
    }

    async function loadOpenCV() {
        if (window.cv?.Mat) return;
        if (_openCvLoadPromise) return _openCvLoadPromise;

        _openCvLoadPromise = (async () => {
            if (!window.cv) await injectOpenCvScript();
            await waitForOpenCvRuntime();
        })();

        try {
            await _openCvLoadPromise;
        } catch (error) {
            _openCvLoadPromise = null;
            document.getElementById(OPEN_CV_SCRIPT_ID)?.remove();
            if (!window.cv?.Mat) delete window.cv;
            throw error;
        }
    }

    async function preloadAll(progressRef = null) {
        if (_preloadPromise) return _preloadPromise;

        _preloadPromise = (async () => {
            const tasks = [
                { label: 'OpenCV runtime', load: loadOpenCV },
                ...DEPENDENCY_SCRIPTS.map(([label, id, url]) => ({
                    label,
                    load: () => loadDependencyScript(id, url),
                })),
                ..._preloaders,
            ];

            for (let i = 0; i < tasks.length; i++) {
                const task = tasks[i];
                // Don't await .NET progress callbacks — awaiting them while C# is
                // blocked on this Promise can deadlock Blazor WASM interop.
                progressRef?.invokeMethodAsync(
                    'OnPreloadProgress', i, tasks.length, `Loading ${task.label}\u2026`
                );
                await task.load();
                progressRef?.invokeMethodAsync(
                    'OnPreloadProgress', i + 1, tasks.length, `${task.label} ready`
                );
            }
        })();

        try {
            await _preloadPromise;
        } catch (error) {
            _preloadPromise = null;
            throw error;
        }
    }

    return {
        preload(progressRef) {
            return preloadAll(progressRef);
        },

        async init(videoEl, canvasEl) {
            _video  = videoEl;
            _canvas = canvasEl;

            await preloadAll();

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

            const rect  = _canvas.getBoundingClientRect();
            const scale = Math.min(rect.width / _canvas.width, rect.height / _canvas.height);
            const offX  = (rect.width  - _canvas.width  * scale) / 2;
            const offY  = (rect.height - _canvas.height * scale) / 2;

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
