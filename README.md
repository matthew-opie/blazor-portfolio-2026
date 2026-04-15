# mattopie.com

[![Deploy to AWS S3](https://github.com/matthew-opie/blazor-portfolio-2026/actions/workflows/deployToS3.yml/badge.svg)](https://github.com/matthew-opie/blazor-portfolio-2026/actions/workflows/deployToS3.yml)

Personal portfolio and project playground — live at **[mattopie.com](https://www.mattopie.com)**.

Built on .NET 10 Blazor WebAssembly. Deployed automatically to AWS S3 on every push to `main` via GitHub Actions, with Cloudflare handling DNS and edge caching.

---

## Projects

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

## Adding Typing Test Passages

Passages are stored in [`wwwroot/data/passages.json`](wwwroot/data/passages.json) and loaded at runtime, so no recompile is needed to add or edit them. Each entry follows this shape:

```json
{
  "attribution": "Title — Author, Year",
  "text": "The full passage text goes here."
}
```
