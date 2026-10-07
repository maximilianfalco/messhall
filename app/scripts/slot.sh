#!/bin/bash
# Runs a command in one of 2 slots at background priority, so at most 2 app builds run at once and audio stays smooth.
# lockf exits 75 when a slot is taken, so try the next one and wait when both are.
while true; do
  for slot in 1 2; do
    lockf -s -t 0 "/tmp/messhall-app-slot-$slot.lock" taskpolicy -b nice -n 19 "$@"
    code=$?
    [ "$code" -ne 75 ] && exit "$code"
  done
  sleep 2
done
