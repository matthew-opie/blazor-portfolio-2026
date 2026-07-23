# mattopie.com

[![Deploy to AWS S3](https://github.com/matthew-opie/blazor-portfolio-2026/actions/workflows/deployToS3.yml/badge.svg)](https://github.com/matthew-opie/blazor-portfolio-2026/actions/workflows/deployToS3.yml)

Personal portfolio and project playground — live at **[mattopie.com](https://www.mattopie.com)**.

Built on .NET 10 Blazor WebAssembly. Deployed automatically to AWS S3 on every push to `main` via GitHub Actions, with Cloudflare handling DNS and edge caching.

---

## Projects

### [AI Onboarding Demo](https://www.mattopie.com/onboarding)
A live **Compliance Intelligence Console** for a multi-tenant institutional client onboarding platform. The dashboard connects to a production .NET 10 AWS Lambda API — no mock data — and demonstrates hybrid RAG over tenant-scoped policy documents.

Switch between 10 isolated tenants (`tenant_001`–`tenant_010`), run compliance queries, inspect retrieved context (BM25 vs dense vector hits, hybrid rerank scores, parent-child chunks), watch MCP tool invocations in a live execution log, and review per-query telemetry (vector search latency, DynamoDB assembly, RAGAS faithfulness, cross-tenant leak rate).

The backend uses a single-table DynamoDB schema, Qdrant vector search, BM25 + dense hybrid retrieval with RRF fusion, and an MCP agent layer that runs compliance checks before synthesis. Tenant switches reset chat, tool logs, and metrics to prove partition isolation.

Also reachable from the nav bar (**AI Onboarding Demo**, after Portfolio) or the [portfolio page](https://www.mattopie.com/portfolio).

### [CV Playground](https://www.mattopie.com/cv)
An in-browser computer vision sandbox running OpenCV.js, TensorFlow.js, and MediaPipe models entirely client-side. Upload an image or use the webcam, pick from a catalog of algorithms (edge detection, segmentation, face/pose estimation, depth, and more), tune parameters with live sliders, and compare outputs side by side. Models and WASM binaries are bundled locally under `wwwroot/lib/cv/`.

### [Tomato Timer](https://www.mattopie.com/pomodoro)
A Pomodoro-technique productivity timer with three independent modes — Focus, Short Break, and Long Break — each with their own state, animated SVG progress ring, and color-coded theme. Browser notifications and the Vibration API fire on session completion. A session dot tracker counts completed pomodoros and auto-suggests the next break type.

### [Typing Speed Test](https://www.mattopie.com/typing)
A live WPM typing test using passages from public domain literature. Passages are loaded from an external JSON file (`wwwroot/data/passages.json`) and shuffled into a non-repeating queue each session. Text is scored character-by-character in real time with per-keystroke color feedback. The test ends when the passage is complete or the 60-second timer expires, then reports WPM, accuracy, and elapsed time. Backspace support allows correcting the previous word mid-test.

### [Markdown Previewer](https://www.mattopie.com/markdown)
A live split-pane Markdown editor with instant HTML preview, powered by the [Markdig](https://github.com/xoofx/markdig) library. Supports the full CommonMark spec plus tables, fenced code blocks, task lists, and autolinks. A toolbar provides one-click insertion of common syntax at the cursor position with selected-text wrapping. Includes a live word and character counter and a Copy HTML button.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | .NET 10 Blazor WebAssembly |
| Language | C# |
| Styling | Scoped CSS (component-level) |
| JS Interop | Vanilla JS via `IJSRuntime` |
| Markdown | Markdig |
| Computer vision | OpenCV.js, TensorFlow.js, MediaPipe (client-side WASM) |
| Onboarding API | .NET 10 AWS Lambda · DynamoDB · Qdrant · OpenAI |
| CI/CD | GitHub Actions |
| Hosting | AWS S3 (static site) |
| DNS / CDN | Cloudflare |

---

## Local Development

```bash
git clone https://github.com/matthew-opie/blazor-portfolio-2026.git
cd blazor-portfolio-2026
dotnet run
```

The app will be available at `http://localhost:5000` by default, or specify a port:

```bash
dotnet run --urls http://localhost:5201
```

### AI Onboarding Demo API

The onboarding dashboard requires a configured Lambda Function URL. Set it in [`wwwroot/appsettings.json`](wwwroot/appsettings.json):

```json
{
  "OnboardingApi": {
    "BaseUrl": "https://your-lambda-url.lambda-url.us-east-1.on.aws"
  }
}
```

On load, the dashboard calls `GET /health` and `GET /tenants`, then routes queries to `POST /tenants/{id}/query`. If the API is unreachable or `BaseUrl` is empty, the UI shows a connection error instead of falling back to mock data.

The Lambda backend lives in a separate repo: [`clientonboardinglambda`](https://github.com/matthew-opie/clientonboardinglambda) (not included in this repository).

### Adding Typing Test Passages

Passages are stored in [`wwwroot/data/passages.json`](wwwroot/data/passages.json) and loaded at runtime, so no recompile is needed to add or edit them. Each entry follows this shape:

```json
{
  "attribution": "Title — Author, Year",
  "text": "The full passage text goes here."
}
```
