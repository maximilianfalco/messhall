# QA tape for the restart wake under launchd: with no utf-8 locale tmux prints a tab in a -F format as _,
# while the colon the wake now splits on comes through, and the wake tests pin it.

Output demo/out/restart-wake-locale.mp4
Output demo/out/restart-wake-locale.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-restart-wake-locale"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "tmux kill-session -t wake-locale 2>/dev/null; tmux new-session -d -s wake-locale 'sleep 600'; clear"
Enter
Sleep 1s
Show

Type `env -i PATH=/usr/bin:/bin $(command -v tmux) list-panes -a -F $'#{session_name}\t#{pane_start_command}' | grep wake-locale; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Type `env -i PATH=/usr/bin:/bin $(command -v tmux) list-panes -a -F '#{session_name}:#{pane_start_command}' | grep wake-locale; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Type "pnpm -s vitest run test/doorbell/wake.test.ts test/daemon/server.test.ts 2>&1 | tail -5; echo exit $?"
Sleep 500ms
Enter
Sleep 15s

Hide
Type "tmux kill-session -t wake-locale"
Enter
Sleep 1s
