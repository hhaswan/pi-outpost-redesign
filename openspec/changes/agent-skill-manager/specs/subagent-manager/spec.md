# subagent-manager delta

## ADDED Requirements

### Requirement: AgentDiscovery

The Agents panel SHALL list every sub-agent pi-subagents would see for the current project: global
(`<agentDir>/agents`), project (`<root>/.pi/agents`), shared (`<root>/.agents/agents`), package and
built-in agents. Each card SHALL show the agent name, description, source file, enabled state and
whether it overrides or is overridden by an agent of the same name in a higher-priority source.

#### Scenario: OpenedFromHeaderOnEveryViewport
- **WHEN** the user chooses **Agents** in the wide header, or in the phone's "More controls" sheet
- **THEN** the panel opens as a dialog on wide screens and as a full-screen sheet on a phone, with touch-sized controls on coarse pointers

#### Scenario: ProjectOverridesGlobal
- **GIVEN** `reviewer.md` exists in both `<agentDir>/agents` and `<root>/.pi/agents`
- **WHEN** the Agents panel opens for that project
- **THEN** the project card is marked as overriding and the global card as overridden

#### Scenario: ReadOnlySourcesCannotBeEdited
- **WHEN** the panel shows a package, built-in or `.agents/agents` agent
- **THEN** its edit, rename and delete actions are absent and "Duplicate" is offered

#### Scenario: SubagentsNotLoaded
- **GIVEN** pi-subagents does not answer `subagents:rpc:ping` in the project's runtime
- **WHEN** the panel opens
- **THEN** it states that pi-subagents is not loaded and offers no Run action

### Requirement: ConfinedAgentFileOperations

The server SHALL create, duplicate, rename, delete and rewrite agent files only as
`<global or project agent dir>/<name>.md`, addressed by scope and name, never by a client path.
Names SHALL match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` with at most 128 characters. The server MUST refuse
a symlinked agent directory or target file, and SHALL write atomically.

#### Scenario: TraversalNameRefused
- **WHEN** a client asks to create an agent named `../../.ssh/authorized_keys` or `a/b`
- **THEN** the request is refused as an invalid name and no file is created

#### Scenario: SymlinkedTargetRefused
- **GIVEN** `<root>/.pi/agents/x.md` is a symlink to a file outside the directory
- **WHEN** a client saves agent `x` in project scope
- **THEN** the save is refused and the symlink target is unchanged

#### Scenario: RenameKeepsNameAndFileInStep
- **GIVEN** a project agent `helper` created by the panel
- **WHEN** it is renamed to `doc-helper`
- **THEN** `helper.md` no longer exists, `doc-helper.md` exists with `name: doc-helper`, and its other content is unchanged

#### Scenario: RenameOntoExistingRefused
- **GIVEN** project agents `a` and `b`
- **WHEN** `a` is renamed to `b`
- **THEN** the rename is refused and both files are unchanged

#### Scenario: DuplicateReadOnlyIntoScope
- **WHEN** the user duplicates a built-in agent into global scope as `my-explore`
- **THEN** `<agentDir>/agents/my-explore.md` is created with its prompt and settings and `name: my-explore`

### Requirement: FrontmatterPreservingRewrite

Saving an agent SHALL change only the frontmatter keys the user edited and the body when edited.
Unknown keys, comments, key order and line endings MUST be preserved byte for byte. A save SHALL
carry the hash of the content it was based on and SHALL be refused as a conflict when the file
changed on disk since.

#### Scenario: UnknownFieldsPreserved
- **GIVEN** an agent file with `memory: project`, `isolation: worktree`, a YAML comment and CRLF line endings
- **WHEN** the user changes only its model in the panel
- **THEN** the saved file differs from the original only in the `model:` line

#### Scenario: ExternalEditConflict
- **GIVEN** the panel loaded an agent file
- **WHEN** the file is changed on disk and the user then saves
- **THEN** the save is refused as a conflict and the file keeps the external change

### Requirement: SkillAttachment

The panel SHALL let the user choose for each writable agent: all skills (no `skills:` key), no
skills (`skills: false`), or a selection written as a comma-separated `skills:` list, where an empty
selection writes `skills: false`. Only skills that pi-subagents' skill loader resolves for the
current project SHALL be attachable; other inventoried skills SHALL be shown disabled with the
reason. Attached names that no longer resolve SHALL be flagged.

#### Scenario: AttachTwoSkills
- **GIVEN** skills `pdf` and `docx` exist under `~/.pi/agent/skills`
- **WHEN** the user selects both for agent `writer`
- **THEN** `writer.md` contains `skills: pdf, docx` and no other line changes

#### Scenario: DetachAllWritesFalse
- **WHEN** the user clears every selected skill of an agent in selection mode
- **THEN** the file contains `skills: false`

#### Scenario: InheritRemovesKey
- **WHEN** the user chooses "All skills" for an agent that had `skills: pdf`
- **THEN** the `skills:` key is removed from the file

#### Scenario: UnreachableSkillDisabled
- **GIVEN** a skill loaded from an enrolled repository outside the sub-agent skill roots, or from a symlinked root
- **WHEN** the skills checklist is shown
- **THEN** that skill cannot be selected and its reason is shown

#### Scenario: MissingAttachedSkillFlagged
- **GIVEN** an agent with `skills: gone` and no skill named `gone` in any root
- **WHEN** the panel shows the agent
- **THEN** `gone` is flagged as not found

### Requirement: AgentSettingsEditing

For writable agents the panel SHALL edit the tools allow-list (built-in tool checklist or `all`, with
other existing entries kept verbatim), model (an available model or inherit), thinking level (or
inherit), prompt mode, enabled state and the system prompt (file body). Choosing inherit SHALL
remove the key. The panel SHALL state that tool and skill limits are not a security sandbox.

#### Scenario: ToolsAllowListWritten
- **GIVEN** an agent with `tools: read, mcp:github/*`
- **WHEN** the user also ticks `grep`
- **THEN** the file contains a `tools:` list with `read`, `grep` and `mcp:github/*`

#### Scenario: DisableWritesEnabledFalse
- **WHEN** the user disables an agent
- **THEN** the file contains `enabled: false`, and enabling it again removes that key

#### Scenario: PromptEditKeepsFrontmatter
- **WHEN** the user edits the system prompt and saves
- **THEN** the body after the closing `---` is the new text and the frontmatter is unchanged

#### Scenario: SandboxDisclaimerShown
- **WHEN** the skills or tools editor is shown
- **THEN** it states that these limits are not a security sandbox

### Requirement: RunAgentInProject

On the embedded runtime the panel SHALL spawn an enabled agent with a user-entered prompt by
emitting `subagents:rpc:spawn` on the current project's runtime event bus and SHALL show the reply's
agent id or error. A reply that does not arrive within 10 seconds SHALL be reported as a timeout.

#### Scenario: RunSpawnsInCurrentProject
- **GIVEN** an enabled project agent `reviewer` and pi-subagents loaded
- **WHEN** the user runs it with prompt "check README"
- **THEN** `subagents:rpc:spawn` is emitted on that project's runtime with type `reviewer` and that prompt
- **AND** the panel shows the returned agent id

#### Scenario: RunUnavailableOnRpcRuntime
- **GIVEN** the project uses the `rpc` agent runtime
- **WHEN** the panel opens
- **THEN** Run is unavailable with the reason

#### Scenario: RunTimeout
- **GIVEN** a runtime whose event bus never replies to the spawn request
- **WHEN** the user runs an agent
- **THEN** after 10 seconds the panel reports a timeout
