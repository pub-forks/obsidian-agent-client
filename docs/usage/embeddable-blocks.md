# Embeddable Agent Blocks

Drop a live agent chat or a quick-action button straight into a note using a fenced code block. The block renders inline in Reading view, so the chat lives next to the content it is about.

## Fence Languages

A block is written as a fenced code block whose language is either `agent-client` or `agent`. The two are interchangeable aliases for the same renderer — pick whichever reads better in your note.

````md
```agent-client
type: chat
```
````

````md
```agent
type: button
text: Summarize this note
prompt: Summarize the note I'm reading.
```
````

The fence body is parsed as YAML (`key: value` pairs). A `type` field decides what the block becomes:

| `type` | Result |
|--------|--------|
| `chat` | An embedded chat view (default) |
| `button` | A button that opens a chat with a preset prompt |

::: tip
An **empty body** renders a default chat block — so the shortest possible embed is just an empty `agent-client` fence. It uses your default agent with no other options.

````md
```agent-client
```
````
:::

## Chat Blocks

A chat block (`type: chat`, or no `type` at all) mounts a fully interactive chat inside the note.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `chat` | `chat` | Selects the chat block. Optional. |
| `agent` | string | view default | Agent id to use (e.g. `claude-code-acp`). When omitted, the configured **Default agent** is used. |
| `model` | string | agent default | Model id to select once the session is ready. Must be a model the agent exposes. |
| `height` | CSS length | `520px` | Max height of the embedded chat (capped at `80vh`). See [supported units](#height-units) below. |
| `id` | string | auto / none | Stable block id used as the persistence key. See [Persistence](#persistence). |
| `persist` | boolean | `false` | Restore the latest saved session for this block on reload. |
| `noteContext` | `hosting` | (active note) | Pin auto-mention to the note hosting the block instead of the currently active note. |

#### Height units {#height-units}

`height` accepts a bare CSS length using one of these units: `px`, `em`, `rem`, `vh`, `vw`, `%`. The number may be an integer or a decimal, and the unit is case-insensitive.

A single space between the number and the unit is tolerated and collapsed — both `400px` and `400 px` normalize to `400px`. Negative values and anything that is not a plain length (calc expressions, multiple values, unitless numbers) are rejected with a non-fatal warning, and the block falls back to the default height.

#### noteContext

By default an embedded chat auto-mentions whichever note is currently active, just like a sidebar chat. Setting `noteContext: hosting` pins auto-mention to the note that contains the block, so the chat always has the surrounding note as context even while you click around elsewhere.

::: tip
`hosting` is currently the only accepted value. Any other value is treated as a structural error (see [Validation](#validation-and-warnings)).
:::

## Persistence

By default an embedded chat starts a fresh session each time the note is reopened. Set `persist: true` to have the block reattach to its most recent saved session on reload.

::: warning Device-local by design
The mapping between a block and its saved session lives in **this device's plugin data**, not in the note. It is **never written into the note** and is **not synced** between devices. A session id is **never** stored in your Markdown.

The practical effect: a persisted chat reattaches to its history on the device where it was created, while the same note opened on another device simply starts fresh. Your notes stay portable and contain no machine-specific identifiers.
:::

### Stable block id

Persistence keys on a device-neutral `id` so the mapping survives renaming or moving the note.

- If a `persist` chat block **does not** declare an `id`, the plugin generates one and injects it into the fence **once** — you will see an `id:` line appear in the block the first time it renders. After that the value is fixed.
- If you **hand-write** an `id`, it is honored as-is and never overwritten.
- If the persisted session **cannot be restored** (for example, the agent no longer has that session), the block **silently starts a fresh chat** rather than showing an error.

::: tip
Auto-injection only happens for `persist: true` chat blocks that lack an `id`. Non-persisted blocks and button blocks are never modified.
:::

## Button Blocks

A button block renders a single button. Clicking it opens a chat and delivers your preset prompt to it.

````md
```agent-client
type: button
text: Review this note
prompt: Review the note I'm currently editing for clarity and accuracy.
viewType: floating
autoSend: true
```
````

### Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `type` | `button` | yes | — | Must be `button`. |
| `text` | string | yes | — | The button label. Must be non-empty. |
| `prompt` | string | yes | — | The prompt delivered to the opened chat. Must be non-empty. |
| `agent` | string | no | view default | Agent id for the opened chat. |
| `viewType` | enum | no | `right-pane` | Where to open the chat. See [values](#viewtype-values). |
| `autoSend` | boolean | no | `false` | Send the prompt immediately on open instead of leaving it in the input. |

#### viewType values {#viewtype-values}

`viewType` accepts a canonical value or one of its aliases:

| Canonical | Aliases | Opens in |
|-----------|---------|----------|
| `right-pane` | `right`, `right-tab` | The right sidebar |
| `floating` | `float`, `floating-chat` | A floating chat window |
| `editor-tab` | `tab` | A normal editor tab |
| `embedded` | `embed`, `embeddable` | An embedded view |

## Validation and Warnings {#validation-and-warnings}

The parser draws a deliberate line between fields that must be correct and fields that can be sloppy.

### Strict fields (inline error)

If a required or structural field is wrong, the block does not render — it shows an inline error with the offending source instead. This applies to:

- A body that is not valid YAML, or is valid YAML that is not a mapping (key/value pairs).
- An unknown `type` (anything other than `chat` or `button`).
- An unknown `noteContext` (anything other than `hosting`).
- An unknown `viewType` that is neither a canonical value nor a recognized alias.
- A button block missing a non-empty `text` or `prompt`.

### Lenient fields (non-fatal warning)

Optional, "soft" fields never break the block. When their value is unrecognized, the block still renders and shows a small, non-fatal warning above it:

- `persist` and `autoSend` accept `true`/`false`, `yes`/`no`, `on`/`off`, and `1`/`0`, **case-insensitive**. An unrecognized value defaults to `false` with a warning. (An absent value simply defaults to `false`, no warning.)
- An unrecognized `height` is ignored, falling back to the default, with a warning.
- An **unknown `agent` id** falls back to the default agent, with a warning.

## Examples

A minimal embedded chat using the default agent:

````md
```agent-client
```
````

A pinned, persistent chat with a fixed height and a specific agent:

````md
```agent-client
type: chat
agent: claude-code-acp
height: 600px
persist: true
noteContext: hosting
```
````

A chat with a hand-written stable id:

````md
```agent-client
type: chat
id: weekly-review
persist: true
```
````

A button that opens a floating chat and sends immediately:

````md
```agent
type: button
text: Draft a summary
prompt: Draft a concise summary of this note.
viewType: floating
autoSend: yes
```
````

A button that opens an embedded chat (alias `embed`) without auto-sending:

````md
```agent-client
type: button
text: Ask about this note
prompt: I have a question about this note.
viewType: embed
```
````
