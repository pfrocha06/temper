# Connector catalog with OAuth

## Behaviour
- Catalog fed by the official MCP Registry API (`registry.modelcontextprotocol.io/v0/servers`),
  cached locally. Servers whose publisher namespace matches the vendor's own domain are marked
  **verified**; others are **community — review before connecting**. A curated starter list:
  GitHub, Slack, Sentry, Linear, Notion, Figma (no Atlassian).
- **Connect** runs the MCP authorization flow (OAuth 2.1, dynamic client registration, PKCE) in the
  browser; tokens are stored in `~/.temper/secrets` (or the OS keychain) and refreshed by Temper.
- Agents never hold connector credentials: runs talk to a local **credential proxy** in Temper with
  their per-run capability; the proxy forwards to the remote MCP server with the board's token.
- Each connector is assigned to roles; the work profile may restrict which connectors are allowed.

## Acceptance criteria
- AC-1: Connecting a verified remote server completes OAuth in the browser and lists its tools.
- AC-2: An agent run can call a connected server's tools, and no connector token appears in the run's config, environment or transcript.
- AC-3: Revoking a connector stops all runs from using it immediately.
