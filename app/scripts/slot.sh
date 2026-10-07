#!/bin/bash
# Runs a command in one of 2 slots, so at most 2 app builds or tests run at once on this Mac.
# lockf exits 75 when a slot is taken, so try the next one and wait when both are.
while true; do
  for slot in 1 2; do
    lockf -s -t 0 "/tmp/messhall-app-slot-$slot.lock" "$@"
    code=$?
    [ "$code" -ne 75 ] && exit "$code"
  done
  sleep 2
done
