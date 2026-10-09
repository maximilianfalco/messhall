export type AgentReach = 'claude_session' | 'codex_thread' | 'copy_only';

export interface RunningAgent {
  branch: string | null;
  cwd: string;
  id: string;
  kind: 'claude' | 'codex';
  reach: AgentReach;
  repo: string | null;
  room: string | null;
  status: 'busy' | 'idle' | 'unknown';
}

export interface RoomSuggestion {
  ids: string[];
  key: string;
  room: string;
}
