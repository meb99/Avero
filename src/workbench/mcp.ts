/** The AI connection's defaults and how assistants are told to connect. */

/** Same as MCP_DEFAULT_PORT in src-tauri/src/lib.rs. */
export const MCP_DEFAULT_PORT = 47321;

export const mcpUrl = (port: number) => `http://127.0.0.1:${port}/mcp`;

/** For Claude Code: one command in the terminal. */
export const claudeCodeCommand = (port: number) => `claude mcp add --transport http avero ${mcpUrl(port)}`;

/** For Claude Desktop (claude_desktop_config.json): Avero's own binary as the stdio bridge. */
export function claudeDesktopConfig(executable: string, port: number): string {
  return JSON.stringify({ mcpServers: { avero: { command: executable, args: ["--mcp", String(port)] } } }, null, 2);
}
