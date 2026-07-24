# mattopie.com

[![Deploy to AWS S3](https://github.com/matthew-opie/blazor-portfolio-2026/actions/workflows/deployToS3.yml/badge.svg)](https://github.com/matthew-opie/blazor-portfolio-2026/actions/workflows/deployToS3.yml)

Personal portfolio and project playground — live at **[mattopie.com](https://www.mattopie.com)**.

Built on .NET 10 Blazor WebAssembly. Deployed automatically to AWS S3 on every push to `main` via GitHub Actions, with Cloudflare handling DNS and edge caching.

---

## Projects

### [AI Onboarding Demo](https://www.mattopie.com/onboarding)
A live **Compliance Intelligence Console** for a multi-tenant institutional client onboarding platform. The dashboard connects to production .NET 10 AWS Lambdas — no mock data — and demonstrates hybrid RAG with **live SSE token streaming**, MCP compliance tool logs, ingest status badges, and cached RAGAS faithfulness scores.

Switch between 10 isolated tenants (`tenant_001`–`tenant_010`), run compliance queries, inspect multi-chunk retrieved context with PDF page numbers, watch MCP tool invocations stream in before answer tokens, and review per-query telemetry. Tenant switches reset chat, tool logs, and metrics to prove partition isolation.

**Backend repos:** [ClientOnboardingLambda](https://github.com/matthew-opie/ClientOnboardingLambda) · [DocumentIngestLambda](https://github.com/matthew-opie/DocumentIngestLambda) · [McpComplianceServer](https://github.com/matthew-opie/McpComplianceServer)

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

The app will be available at `http://localhost:5000` by default. If Kestrel binds another port (e.g. `5156`), that origin must be listed on the Lambda Function URL CORS config — or pin a known port:

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

On load, the dashboard runs `GET /health`, `GET /tenants`, and `GET /warm` in parallel. Nav hover on **AI Onboarding Demo** also calls `GET /warm` (best-effort, no OpenAI cost). Queries use `POST /tenants/{id}/query/stream` (SSE) with a non-stream fallback. Regression checks: `.\scripts\run-golden-tests.ps1`.

Backend repos (separate from this site):

| Repo | Purpose |
|------|---------|
| [ClientOnboardingLambda](https://github.com/matthew-opie/ClientOnboardingLambda) | Query API, RAG, RAGAS, MCP client |
| [DocumentIngestLambda](https://github.com/matthew-opie/DocumentIngestLambda) | Async S3→SQS ingest worker |
| [McpComplianceServer](https://github.com/matthew-opie/McpComplianceServer) | Standalone MCP wire-protocol server |
| [onboarding-ragas-eval](https://github.com/matthew-opie/onboarding-ragas-eval) | Golden eval datasets |

### Adding Typing Test Passages

Passages are stored in [`wwwroot/data/passages.json`](wwwroot/data/passages.json) and loaded at runtime, so no recompile is needed to add or edit them. Each entry follows this shape:

```json
{
  "attribution": "Title — Author, Year",
  "text": "The full passage text goes here."
}
```
