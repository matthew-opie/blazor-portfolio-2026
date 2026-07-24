#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
OUTPUT_FILE="${ROOT}/wwwroot/appsettings.json"

if [[ ! -f "$ENV_FILE" ]]; then
  echo ".env not found. Copy .env.example to .env and set ONBOARDING_API_BASE_URL." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${ONBOARDING_API_BASE_URL:-}" ]]; then
  echo "ONBOARDING_API_BASE_URL is missing or empty in .env" >&2
  exit 1
fi

BASE_URL="${ONBOARDING_API_BASE_URL%/}"

cat > "$OUTPUT_FILE" <<EOF
{
  "OnboardingApi": {
    "BaseUrl": "${BASE_URL}"
  }
}
EOF

echo "Wrote ${OUTPUT_FILE}"
