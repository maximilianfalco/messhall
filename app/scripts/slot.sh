#!/bin/bash
# Runs a command in one of 2 slots at background priority, so at most 2 app builds run at once and audio stays smooth.
# A call already inside a slot runs straight away, since waiting on a second slot can deadlock two nested callers.
if [ -n "${MESSHALL_APP_SLOT:-}" ]; then exec "$@"; fi
export MESSHALL_APP_SLOT=1
DIR="${MESSHALL_APP_SLOT_DIR:-/tmp}"
# lockf exits 75 when a slot is taken, so try the next one and wait when both are.
while true; do
  for slot in 1 2; do
    lockf -s -t 0 "$DIR/messhall-app-slot-$slot.lock" taskpolicy -b nice -n 19 "$@"
    code=$?
    [ "$code" -ne 75 ] && exit "$code"
  done
  sleep 2
done
