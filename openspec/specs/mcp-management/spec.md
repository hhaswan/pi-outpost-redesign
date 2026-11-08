# MCP Management Specification

## Purpose

Provide authenticated browser access to the current Pi MCP gateway and its shared configuration without sending a model prompt or restarting the systemd service.

## Requirements

### Requirement: Real runtime status and connections

The browser SHALL open MCP management for `/mcp`, fetch live server status from the active embedded runtime's MCP gateway, and offer explicit connection attempts. It SHALL distinguish cached catalogs, active connections, and saved configuration not yet loaded. Unsupported gateways SHALL report the limitation instead of inventing statuses. It SHALL NOT expose arbitrary gateway tool execution through the management protocol.

#### Scenario: LiveMcpStatus
- **WHEN** the operator opens MCP management
- **THEN** displayed connection status and tool counts come from the active runtime
- **AND** an unsupported runtime reports missing gateway support.

#### Scenario: ConnectMcpServer
- **GIVEN** a configured server and an idle session
- **WHEN** the operator chooses Connect
- **THEN** the active gateway attempts a real connection and refreshed status reports the outcome.

### Requirement: Persistent scoped server configuration

The browser SHALL support add, edit and confirmed removal in separately identified shared-global, global-adapter, project-shared and project-adapter scopes. Writes SHALL preserve unrelated data, use bounded regular files and atomic replacement, and reject stale revisions. Other configuration sources MAY be read-only. Saving SHALL NOT restart a session or service; application SHALL require an explicit idle-session restart.

#### Scenario: SaveEditRemoveMcpConfiguration
- **WHEN** the operator adds, edits, or confirms removal of a server definition
- **THEN** the specified scope is persisted while unrelated data is retained
- **AND** the UI explains that application requires a separate session restart.

#### Scenario: McpEditorFailureAndConflicts
- **WHEN** JSON is invalid or another writer has changed the configuration revision
- **THEN** the operation reports an error without claiming success or overwriting the other writer's data.

### Requirement: Management security and lifecycle

MCP mutations SHALL reject busy/changing sessions, locked policy, invalid scope/name/transport, symlinks, oversized files and malformed documents. Responses SHALL mask credentials and opaque arguments; retained masks SHALL refer only to existing fields and never transfer credentials to a changed transport. Superseded requests/workspaces SHALL NOT replace current state. Disconnect SHALL end loading with a retryable error.

#### Scenario: McpPolicyAndInputBoundaries
- **WHEN** a mutation is busy, locked, malformed, oversized, or names an unsupported scope
- **THEN** the server rejects it before changing configuration.

#### Scenario: McpSecretPreservation
- **WHEN** configuration containing credentials is displayed and edited without replacing those fields
- **THEN** the browser receives masked values and the original values remain intact on disk
- **AND** changing the destination while retaining masked values is refused.

#### Scenario: McpStaleResponseAndDisconnect
- **WHEN** a newer request, workspace replacement, or disconnection supersedes a management request
- **THEN** stale replies cannot replace current state and no disconnected request remains loading indefinitely.
