#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

GO_BIN="${GO:-go}"
DIST_DIR="dist"

usage() {
  cat <<'EOF'
Usage: ./build.sh [target ...]

Targets:
  macos-x64     macOS Intel
  macos-arm64   macOS Apple Silicon
  windows-x64   Windows Intel/AMD 64-bit
  windows-arm64 Windows ARM64
  linux-x64     Linux x86-64
  linux-arm64   Linux ARM64
  all           Build every target above

With no target, builds the current system automatically.

Examples:
  ./build.sh
  ./build.sh windows-arm64
  ./build.sh all
EOF
}

build_target() {
  local target="$1"
  local goos=""
  local goarch=""
  local output=""

  case "$target" in
    macos-x64)
      goos="darwin"
      goarch="amd64"
      output="context_llm_macos_amd64"
      ;;
    macos-arm64)
      goos="darwin"
      goarch="arm64"
      output="context_llm_macos_arm64"
      ;;
    windows-x64)
      goos="windows"
      goarch="amd64"
      output="context_llm_windows_amd64.exe"
      ;;
    windows-arm64)
      goos="windows"
      goarch="arm64"
      output="context_llm_windows_arm64.exe"
      ;;
    linux-x64)
      goos="linux"
      goarch="amd64"
      output="context_llm_linux_amd64"
      ;;
    linux-arm64)
      goos="linux"
      goarch="arm64"
      output="context_llm_linux_arm64"
      ;;
    *)
      echo "Unknown target: $target" >&2
      usage >&2
      exit 2
      ;;
  esac

  mkdir -p "$DIST_DIR"
  echo "Building $target -> $DIST_DIR/$output"
  GOOS="$goos" GOARCH="$goarch" "$GO_BIN" build -trimpath -o "$DIST_DIR/$output" .
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then
  current_goos="$("$GO_BIN" env GOOS)"
  current_goarch="$("$GO_BIN" env GOARCH)"
  case "${current_goos}/${current_goarch}" in
    darwin/amd64) targets=("macos-x64") ;;
    darwin/arm64) targets=("macos-arm64") ;;
    windows/amd64) targets=("windows-x64") ;;
    windows/arm64) targets=("windows-arm64") ;;
    linux/amd64) targets=("linux-x64") ;;
    linux/arm64) targets=("linux-arm64") ;;
    *)
      echo "Unsupported current platform: ${current_goos}/${current_goarch}" >&2
      exit 2
      ;;
  esac
elif [[ ${#targets[@]} -eq 1 && "${targets[0]}" == "all" ]]; then
  targets=(
    "macos-x64"
    "macos-arm64"
    "windows-x64"
    "windows-arm64"
    "linux-x64"
    "linux-arm64"
  )
fi

for target in "${targets[@]}"; do
  build_target "$target"
done
