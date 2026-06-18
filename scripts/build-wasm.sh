#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
wasm-pack build engine-rust --target web --out-dir pkg
mkdir -p web/public/engine
cp engine-rust/pkg/network_engine.js web/public/engine/network_engine.js
cp engine-rust/pkg/network_engine_bg.wasm web/public/engine/network_engine_bg.wasm
