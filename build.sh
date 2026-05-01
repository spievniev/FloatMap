#!/bin/bash

set -euo pipefail

mkdir -p build

clang --target=wasm32 --no-standard-libraries                   \
      -std=c23 -Wall -Wextra -pedantic -O3                      \
      -Wl,--no-entry,--export-all,--strip-all,--allow-undefined \
      -o build/render.wasm src/render.c

cp src/index.html build
cp src/index.js build
cp assets/favicon.ico build
