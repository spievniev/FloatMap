#!/bin/bash

set -euo pipefail

mkdir -p build

clang --target=wasm32 --no-standard-libraries -Wl,--no-entry -Wl,--export-all -o build/render.wasm src/render.c

cp src/index.html build
cp src/index.js build
cp assets/favicon.ico build
