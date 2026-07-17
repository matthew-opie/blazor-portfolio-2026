/**
 * Download TF.js model.json + weight shards into wwwroot/lib/cv/models.
 * Usage: node tools/download-tf-models.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..', 'wwwroot', 'lib', 'cv', 'models');

const MODELS = [
  {
    id: 'coco-ssd-lite-mobilenet-v2',
    modelJson: 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json',
  },
  {
    id: 'movenet-lightning',
    modelJson: 'https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4/model.json?tfjs-format=file',
  },
  {
    id: 'movenet-thunder',
    modelJson: 'https://tfhub.dev/google/tfjs-model/movenet/singlepose/thunder/4/model.json?tfjs-format=file',
  },
  {
    id: 'hand-detector-lite',
    modelJson: 'https://tfhub.dev/mediapipe/tfjs-model/handpose_3d/detector/lite/1/model.json?tfjs-format=file',
  },
  {
    id: 'hand-detector-full',
    modelJson: 'https://tfhub.dev/mediapipe/tfjs-model/handpose_3d/detector/full/1/model.json?tfjs-format=file',
  },
  {
    id: 'hand-landmark-lite',
    modelJson: 'https://tfhub.dev/mediapipe/tfjs-model/handpose_3d/landmark/lite/1/model.json?tfjs-format=file',
  },
  {
    id: 'hand-landmark-full',
    modelJson: 'https://tfhub.dev/mediapipe/tfjs-model/handpose_3d/landmark/full/1/model.json?tfjs-format=file',
  },
  {
    id: 'face-detection-short',
    modelJson: 'https://tfhub.dev/mediapipe/tfjs-model/face_detection/short/1/model.json?tfjs-format=file',
  },
  {
    id: 'face-mesh',
    modelJson: 'https://tfhub.dev/mediapipe/tfjs-model/face_landmarks_detection/face_mesh/1/model.json?tfjs-format=file',
  },
  {
    id: 'face-attention-mesh',
    modelJson: 'https://tfhub.dev/mediapipe/tfjs-model/face_landmarks_detection/attention_mesh/1/model.json?tfjs-format=file',
  },
  {
    id: 'bodypix-mobilenet-075-s16-q2',
    modelJson: 'https://storage.googleapis.com/tfjs-models/savedmodel/bodypix/mobilenet/quant2/075/model-stride16.json',
  },
  {
    id: 'ar-portrait-depth',
    modelJson: 'https://tfhub.dev/tensorflow/tfjs-model/ar_portrait_depth/1/model.json?tfjs-format=file',
  },
  {
    id: 'selfie-segmentation-general',
    modelJson: 'https://tfhub.dev/mediapipe/tfjs-model/selfie_segmentation/general/1/model.json?tfjs-format=file',
  },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; cv-model-vendor/1.0)',
  Accept: '*/*',
};

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 12) return reject(new Error('Too many redirects: ' + url));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: HEADERS }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        get(next, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`${url} -> HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        buf: Buffer.concat(chunks),
        type: res.headers['content-type'] || '',
      }));
    });
    req.on('error', reject);
  });
}

function isHtml(buf, type) {
  if (/text\/html/i.test(type)) return true;
  const head = buf.subarray(0, 64).toString('utf8').trim().toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

function shardUrl(modelJsonUrl, relPath) {
  const base = new URL('.', modelJsonUrl).toString(); // keeps query on same origin path parent
  // new URL(rel, base) drops ?tfjs-format=file from parent file URL in some cases,
  // so rebuild carefully for TF Hub.
  const modelUrl = new URL(modelJsonUrl);
  const dirPath = modelUrl.pathname.replace(/[^/]+$/, '');
  const url = new URL(modelUrl.origin + dirPath + relPath);
  if (modelUrl.searchParams.has('tfjs-format')) {
    url.searchParams.set('tfjs-format', modelUrl.searchParams.get('tfjs-format'));
  }
  return url.toString();
}

async function downloadModel({ id, modelJson }, { force = false } = {}) {
  const destDir = path.join(ROOT, id);
  fs.mkdirSync(destDir, { recursive: true });
  const localJsonPath = path.join(destDir, path.basename(new URL(modelJson).pathname) === 'model-stride16.json'
    ? 'model.json'
    : 'model.json');

  // Always store as model.json locally for uniform loading.
  console.log(`\n[${id}] ${modelJson}`);
  const { buf: jsonBuf, type: jsonType } = await get(modelJson);
  if (isHtml(jsonBuf, jsonType)) throw new Error('model.json looked like HTML');
  fs.writeFileSync(localJsonPath, jsonBuf);
  console.log(`  wrote model.json (${jsonBuf.length} bytes)`);

  const manifest = JSON.parse(jsonBuf.toString('utf8'));
  const paths = new Set();
  for (const group of (manifest.weightsManifest || [])) {
    for (const p of (group.paths || [])) paths.add(p);
  }

  if (paths.size === 0) {
    console.log('  WARNING: no weight shards listed');
    return;
  }

  for (const rel of paths) {
    const out = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (!force && fs.existsSync(out) && fs.statSync(out).size > 100000) {
      // Keep likely-good binaries; re-fetch tiny/HTML stubs
      console.log(`  skip ${rel} (exists, ${fs.statSync(out).size} bytes)`);
      continue;
    }
    const url = shardUrl(modelJson, rel);
    process.stdout.write(`  GET ${rel} ... `);
    const { buf, type } = await get(url);
    if (isHtml(buf, type)) throw new Error(`shard ${rel} returned HTML from ${url}`);
    fs.writeFileSync(out, buf);
    console.log(`${buf.length} bytes`);
  }

  // BodyPix remote file is model-stride16.json; normalize local name already handled.
  // If original basename differs and weightsManifest paths are relative, fine.
}

(async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  const force = process.argv.includes('--force');
  let failed = 0;
  for (const m of MODELS) {
    try {
      await downloadModel(m, { force });
    } catch (e) {
      failed++;
      console.error(`FAILED ${m.id}: ${e.message}`);
    }
  }
  console.log(`\nDone. failed=${failed}`);
  process.exit(failed ? 1 : 0);
})();
