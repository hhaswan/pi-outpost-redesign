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

The browser SHALL add URL or stdio configuration, edit existing definitions, and remove a selected definition after confirmation. Writes SHALL preserve unrelated configuration, use bounded regular files and atomic replacement, and reject stale revisions. Shared global, global adapter, project shared, and project adapter files SHALL be identified separately. Other imported or extension-owned servers MAY be listed without edit actions when their defining file is outside those supported scopes. Configuration changes SHALL explicitly require an operator-initiated idle-session restart to take effect; saving SHALL NOT restart either the session or service.

#### Scenario: SaveEditRemoveMcpConfiguration
- **WHEN** the operator adds, edits, or confirms removal of a server definition
- **THEN** the specified scope is persisted while unrelated data is retained
- **AND** the UI explains that application requires a separate session restart.

#### Scenario: McpEditorFailureAndConflicts
- **WHEN** JSON is invalid or another writer has changed the configuration revision
- **THEN** the operation reports an error without claiming success or overwriting the other writer's data.

### Requirement: Management security and lifecycle

MCP mutations SHALL be refused while the session is working or changing, or when sandbox/extension policy locks configuration. Requests SHALL validate scope, name and transport. Credentials and opaque arguments SHALL stay masked in browser responses, and masked values SHALL be retained only from existing fields. A changed transport SHALL NOT silently inherit masked credentials. File symlinks, oversized files and malformed documents SHALL be refused. Replies from superseded requests or replaced workspaces SHALL NOT overwrite the current panel. Disconnection SHALL end loading with a retryable error.

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
