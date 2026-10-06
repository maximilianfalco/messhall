# QA tape for topics set by agents: set_topic is listed with its budget, a join that makes a room sets its topic,
# the maker changes it with set_topic, then the tool and store tests run (a later join, a non maker, muted, closed).

Output demo/out/agent-topic.mp4
Output demo/out/agent-topic.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-agent-topic"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s messhall-dev mcp | grep -A1 '^set_topic'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev mcp --tool join --input '{"room":"demo","as":"api","topic":"checkout totals in cents"}' | head -2; echo exit $pipestatus[1]`
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev mcp --tool set_topic --as api --room demo --input '{"room":"demo","topic":"totals in cents, web adapts"}'; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/mcp/setTopic.test.ts test/rooms/store.test.ts -t 'topic' --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 8s

Sleep 8s
