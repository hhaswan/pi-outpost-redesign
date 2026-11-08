# Model Selection

## Purpose

Provide searchable, accessible model selection without changing the server-owned current model or model-change protocol.

## Requirements

### Requirement: SearchableModelPicker

The model control SHALL display the current provider/model identifier and offer a searchable list of available models. Search SHALL match provider, model identifier, and display name case-insensitively. Selecting a result SHALL pass the original provider and complete model identifier separately to the existing model-change callback. The control SHALL continue displaying the server-reported model until the server updates it.

#### Scenario: SearchModelsCaseInsensitively
- **GIVEN** multiple available providers and models
- **WHEN** the user opens the picker and searches by provider, model identifier, or display name with different casing
- **THEN** the search input receives focus and only matching models appear
- **AND** clearing the query restores all available models and the current model is marked selected

#### Scenario: SelectModelWithKeyboard
- **WHEN** the user opens the picker with an arrow key, navigates results using Up or Down, and presses Enter
- **THEN** the active result is selected with its original provider and complete identifier
- **AND** the picker closes and focus returns to the model control
- **AND** the displayed current model remains server-owned

#### Scenario: SelectModelWithPointer
- **WHEN** the user clicks an available model in the picker
- **THEN** the model-change callback receives that provider and complete identifier once
- **AND** the picker closes and focus returns to the model control

#### Scenario: DismissModelSearch
- **WHEN** the user presses Escape in the picker
- **THEN** the picker closes without changing the model and focus returns to the model control
- **AND** reopening the picker clears the prior search
- **AND** clicking outside or moving focus outside closes the picker without changing the model

#### Scenario: EmptyModelSearch
- **WHEN** a search matches no available model
- **THEN** the picker displays "No models found." and exposes no active result
- **AND** arrow keys and Enter do not select a model
- **AND** changing the query to a matching value restores matching results

#### Scenario: StreamingDisablesModelSelection
- **WHEN** streaming starts while the picker is open
- **THEN** the picker closes and the model control becomes disabled
- **AND** no model can be selected while streaming
- **AND** the picker remains closed when streaming ends

#### Scenario: UnlistedCurrentModelRemainsVisible
- **GIVEN** the server reports a model absent from the available models
- **WHEN** the model control renders or its picker opens
- **THEN** the current identifier remains visible instead of displaying another model
- **AND** an empty available-model list displays "No models found."

### Requirement: ResponsiveModelPicker

The model control, search input, and results SHALL provide touch targets at least 44 CSS pixels high. The picker SHALL bound its width to the viewport, wrap long result identifiers, and scroll long result lists without hiding other model-bar controls.

#### Scenario: NarrowModelPicker
- **GIVEN** a narrow mobile viewport and long model identifiers
- **WHEN** the user opens the model picker
- **THEN** the picker stays within the viewport, long results wrap, and the result list has bounded scrolling
- **AND** the model control, search input, and results remain at least 44 CSS pixels high
