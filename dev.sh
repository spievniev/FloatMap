#!/bin/bash

set -euo pipefail

git ls-files | entr ./build.sh &
PID1=$!

npx live-server build >/dev/null &
PID2=$!

trap "kill $PID1 $PID2" EXIT
wait -n $PID1 $PID2
