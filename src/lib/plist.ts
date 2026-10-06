import { LAUNCH_AGENT_LABEL, NODE_QUIET_FLAG } from '../config.js';

const XML_ESCAPES: Record<string, string> = { '"': '&quot;', '&': '&amp;', "'": '&apos;', '<': '&lt;', '>': '&gt;' };

const escape = (text: string) => text.replaceAll(/["&'<>]/g, char => XML_ESCAPES[char] ?? char);
const str = (text: string) => `<string>${escape(text)}</string>`;

/** The daemon's LaunchAgent. KeepAlive only restarts a crash, so a clean stop stays stopped.
 * launchd ignores the shell PATH, so node is the absolute path seen at install time. */
export function launchAgentPlist({
  cliPath,
  logPath,
  nodePath,
}: {
  cliPath: string;
  logPath: string;
  nodePath: string;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${str(LAUNCH_AGENT_LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${str(nodePath)}
    ${str(NODE_QUIET_FLAG)}
    ${str(cliPath)}
    ${str('daemon')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_OPTIONS</key>
    ${str(NODE_QUIET_FLAG)}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  ${str(logPath)}
  <key>StandardErrorPath</key>
  ${str(logPath)}
</dict>
</plist>
`;
}

/** The node binary a plist from `launchAgentPlist` runs, so `status` can warn when it is gone. */
export function plistNodePath(plist: string) {
  const match = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(plist);
  return match?.[1]
    ?.replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
