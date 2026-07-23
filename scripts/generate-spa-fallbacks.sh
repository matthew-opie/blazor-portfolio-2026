#!/usr/bin/env bash
# Copy index.html to each Blazor route path so S3/Cloudflare deep links return the WASM shell.
set -euo pipefail

ROOT="${1:-wwwroot}"
INDEX="$ROOT/index.html"

if [[ ! -f "$INDEX" ]]; then
  echo "Missing $INDEX — run dotnet publish first." >&2
  exit 1
fi

routes=(
  portfolio
  onboarding
  resume
  cv
  cv/licenses
  markdown
  typing
  pomodoro
  weather
  counter
)

for route in "${routes[@]}"; do
  target_dir="$ROOT/$route"
  mkdir -p "$target_dir"
  cp "$INDEX" "$target_dir/index.html"
done

cp "$INDEX" "$ROOT/404.html"

echo "Generated SPA fallbacks for ${#routes[@]} routes under $ROOT"
echo "Note: also upload bare S3 keys (e.g. s3://bucket/onboarding) from index.html in deploy."
