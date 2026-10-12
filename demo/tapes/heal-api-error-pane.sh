#!/usr/bin/env bash
# A fake claude pane for the heal-api-error tape: its last turn ends in an API error, it waits at the prompt, and
# once a line comes in it shows that line and carries on after a pause, so the stalled status stays in view a while.
rule=$(printf '─%.0s' $(seq 1 100))
box() { printf '\n%s\n❯ \n%s\n  ⏵⏵ auto mode on (shift+tab to cycle)\n' "$rule" "$rule"; }
printf '\033]2;✳ Claude Code\033\\'
clear
printf "⏺ Bash(pnpm messhall-dev check)\n  ⎿  API Error: Can't reach the API server (ENOTFOUND)\n"
box
read -r line
sleep 25
clear
printf "> %s\n\n⏺ Back. Reading the room, then rerunning the gate.\n" "$line"
box
sleep 600
