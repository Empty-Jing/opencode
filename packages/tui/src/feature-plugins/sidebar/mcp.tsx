import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import type { MouseEvent, Renderable, TextareaRenderable } from "@opentui/core"
import { createMemo, For, Match, Show, Switch, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { useSync } from "../../context/sync"
import { useSDK } from "../../context/sdk"
import { useRenderer } from "@opentui/solid"
import { getInteractiveMcpConfig } from "../../mcp/interactive"
import { TuiMcpInputCache } from "../../mcp/input-cache"
import { resolveMcpInputs } from "../../mcp/input-template"
import { inheritTerminalCursorStyle } from "../../util/cursor-style"
import { onCleanup } from "solid-js"

const id = "internal:sidebar-mcp"

type DraftStore = Record<string, string>

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const [loading, setLoading] = createSignal<string | null>(null)
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [pressed, setPressed] = createSignal<string | null>(null)
  const [editing, setEditing] = createSignal(false)
  const [drafts, setDrafts] = createStore<Record<string, DraftStore>>({})
  const inputs: Record<string, Record<string, TextareaRenderable | undefined>> = {}
  let previousFocus: Renderable | null = null
  const renderer = useRenderer()
  const sync = useSync()
  const sdk = useSDK()
  const workspace = () => sync.path.directory || sdk.directory
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.mcp())
  const on = createMemo(() => list().filter((item) => item.status === "connected").length)
  const bad = createMemo(
    () =>
      list().filter(
        (item) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const unregisterCommand = props.api.keymap.registerLayer({
    commands: [
      {
        name: "sidebar.mcp.collapse",
        hidden: true,
        run() {
          if (!expanded()) return
          setExpanded(null)
          setEditingState(false)
        },
      },
    ],
  })

  onCleanup(() => {
    unregisterCommand()
  })

  const dot = (status: string) => {
    if (status === "connected") return theme().success
    if (status === "failed") return theme().error
    if (status === "disabled") return theme().textMuted
    if (status === "needs_auth") return theme().warning
    if (status === "needs_client_registration") return theme().error
    return theme().textMuted
  }

  function focusField(name: string, key: string) {
    const target = inputs[name]?.[key]
    if (!target || target.isDestroyed) return
    setEditingState(true)
    target.focus()
    target.gotoLineEnd()
  }

  function setEditingState(next: boolean) {
    if (editing() === next) return
    if (next) {
      previousFocus = renderer.currentFocusedRenderable
    } else {
      for (const group of Object.values(inputs)) {
        for (const input of Object.values(group)) {
          if (!input || input.isDestroyed || !input.focused) continue
          input.blur()
        }
      }
      if (previousFocus && !previousFocus.isDestroyed) {
        previousFocus.focus()
      }
      previousFocus = null
    }
    setEditing(next)
  }

  useKeyboard((evt) => {
    const name = expanded()
    if (!name) return
    const interactive = getInteractiveMcpConfig(sync.data.config, name)
    const fields = interactive?.inputs ?? []
    if (fields.length === 0) return

    const focused = Object.entries(inputs[name] ?? {}).find(([, input]) => input?.focused)?.[0]
    if (!focused) return

    const index = fields.findIndex((field) => field.key === focused)
    if (index === -1) return

    if (evt.name === "tab") {
      evt.preventDefault()
      evt.stopPropagation()
      const direction = evt.shift ? -1 : 1
      const next = fields[(index + direction + fields.length) % fields.length]
      inputs[name]?.[focused]?.blur()
      focusField(name, next.key)
      return
    }

    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      if (index === fields.length - 1) {
        void connect(name)
        return
      }
      const next = fields[index + 1]
      inputs[name]?.[focused]?.blur()
      focusField(name, next.key)
    }
  })

  async function connect(name: string) {
    if (loading() !== null) return

    setLoading(name)
    try {
      const interactive = getInteractiveMcpConfig(sync.data.config, name)

      if (interactive?.inputs?.length) {
        const cacheWorkspace = workspace()
        if (!cacheWorkspace) {
          props.api.ui.toast({
            title: "MCP 工作区未就绪",
            message: "当前目录尚未同步完成，请稍后重试",
            variant: "warning",
            duration: 4000,
          })
          return
        }

        const current = inputs[name] ?? {}
        const values = Object.fromEntries(
          interactive.inputs.map((field) => [
            field.key,
            current[field.key]?.plainText ?? drafts[name]?.[field.key] ?? field.default ?? "",
          ]),
        )
        setDrafts(name, values)
        for (const field of interactive.inputs) {
          const value = values[field.key]
          if (field.required && !value) {
            props.api.ui.toast({
              title: "MCP 参数未填写",
              message: `${field.label ?? field.key} 不能为空`,
              variant: "warning",
              duration: 4000,
            })
            return
          }
        }

        const resolved = resolveMcpInputs(interactive, values)
        await sdk.client.mcp.add({
          name,
          config: {
            ...resolved,
            enabled: true,
          },
        })
        await Promise.all(
          interactive.inputs.map((field) => TuiMcpInputCache.set(cacheWorkspace, name, field.key, values[field.key] ?? "")),
        )
        setExpanded(null)
        setEditingState(false)
      } else {
        const rawConfig = (sync.data.config as Record<string, any>)?.mcp?.[name]
        await sdk.client.mcp.add({
          name,
          config: {
            ...rawConfig,
            enabled: true,
          },
        })
      }

      const refreshed = await sdk.client.mcp.status()
      if (refreshed.data) sync.set("mcp", refreshed.data)
    } catch (error) {
      console.error("Failed to toggle MCP from sidebar:", error)
      props.api.ui.toast({
        title: "MCP 操作失败",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      })
    } finally {
      setLoading(null)
    }
  }

  async function prepareDrafts(name: string) {
    const interactive = getInteractiveMcpConfig(sync.data.config, name)
    if (!interactive?.inputs?.length) return false

    const cacheWorkspace = workspace()
    if (!cacheWorkspace) return false

    const next: DraftStore = {}
    for (const field of interactive.inputs) {
      next[field.key] = (await TuiMcpInputCache.get(cacheWorkspace, name, field.key)) ?? field.default ?? ""
    }
    setDrafts(name, next)
    return true
  }

  async function select(name: string) {
    if (expanded() && expanded() !== name) {
      await connect(expanded()!)
    }

    const hasInputs = await prepareDrafts(name)
    if (hasInputs) {
      const nextExpanded = expanded() === name ? null : name
      setExpanded(nextExpanded)
      if (!nextExpanded) {
        setEditingState(false)
        return
      }
      queueMicrotask(() => {
        const first = getInteractiveMcpConfig(sync.data.config, name)?.inputs?.[0]
        if (!first) return
        focusField(name, first.key)
      })
      return
    }

    await connect(name)
  }

  async function collapseHeader() {
    if (expanded()) {
      await connect(expanded()!)
    }
    setEditingState(false)
    if (list().length > 2) setOpen((x) => !x)
  }

  function hasSelection() {
    const selection = renderer.getSelection()
    return !!selection && selection.getSelectedText().length > 0
  }

  return (
    <Show when={list().length > 0}>
      <box
        onMouseDown={() => {
          setEditingState(false)
        }}
      >
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => setPressed("header")}
          onMouseUp={() => {
            if (pressed() !== "header") return
            if (hasSelection()) return
            setPressed(null)
            void collapseHeader()
          }}
        >
          <Show when={list().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>MCP</b>
            <Show when={!open()}>
              <span style={{ fg: theme().textMuted }}>
                {" "}
                ({on()} active{bad() > 0 ? `, ${bad()} error${bad() > 1 ? "s" : ""}` : ""})
              </span>
            </Show>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => {
              const interactive = createMemo(() => getInteractiveMcpConfig(sync.data.config, item.name))
              const fields = createMemo(() => interactive()?.inputs ?? [])
              return (
                <box flexDirection="column">
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseDown={() => setPressed(item.name)}
                    onMouseUp={() => {
                      if (pressed() !== item.name) return
                      if (hasSelection()) return
                      setPressed(null)
                      void select(item.name)
                    }}
                  >
                    <text
                      flexShrink={0}
                      style={{
                        fg: loading() === item.name ? theme().warning : dot(item.status),
                      }}
                    >
                      •
                    </text>
                    <text fg={theme().text} wrapMode="word">
                      {item.name}{" "}
                      <span style={{ fg: theme().textMuted }}>
                        <Switch fallback={item.status}>
                          <Match when={expanded() === item.name}>Configure</Match>
                          <Match when={loading() === item.name}>Loading</Match>
                          <Match when={item.status === "connected"}>Connected</Match>
                          <Match when={item.status === "failed"}>
                            <i>{item.error}</i>
                          </Match>
                          <Match when={item.status === "disabled"}>Disabled</Match>
                          <Match when={item.status === "needs_auth"}>Needs auth</Match>
                          <Match when={item.status === "needs_client_registration"}>Needs client ID</Match>
                        </Switch>
                      </span>
                    </text>
                  </box>

                  <Show when={expanded() === item.name && fields().length > 0}>
                    <box
                      flexDirection="column"
                      paddingLeft={3}
                      paddingTop={1}
                      gap={1}
                      onMouseDown={(evt) => {
                        evt.stopPropagation()
                      }}
                      onMouseUp={(evt) => evt.stopPropagation()}
                    >
                      <For each={fields()}>
                        {(field) => {
                          let input: TextareaRenderable | undefined
                          return (
                            <box flexDirection="column">
                              <text fg={theme().textMuted}>{field.label ?? field.key}</text>
                              <textarea
                                ref={(val: TextareaRenderable) => {
                                  input = val
                                  inputs[item.name] ??= {}
                                  inputs[item.name][field.key] = val
                                  val.traits = { status: field.key.toUpperCase() }
                                  queueMicrotask(() => {
                                    if (!input || input.isDestroyed) return
                                    if (drafts[item.name]?.[field.key]) input.gotoLineEnd()
                                  })
                                }}
                                initialValue={drafts[item.name]?.[field.key] ?? ""}
                                minHeight={1}
                                maxHeight={3}
                                keyBindings={[]}
                                placeholder={field.placeholder ?? field.description ?? field.key}
                                placeholderColor={theme().textMuted}
                                textColor={theme().text}
                                focusedTextColor={theme().text}
                                cursorColor={theme().primary}
                                cursorStyle={inheritTerminalCursorStyle}
                                onMouseDown={(evt: MouseEvent) => {
                                  evt.stopPropagation()
                                  setEditingState(true)
                                  evt.target?.focus()
                                }}
                                onSubmit={() => {
                                  setDrafts(item.name, field.key, input?.plainText ?? "")
                                }}
                              />
                            </box>
                          )
                        }}
                      </For>
                      <box
                        onMouseDown={() => setPressed(`save:${item.name}`)}
                        onMouseUp={() => {
                          if (pressed() !== `save:${item.name}`) return
                          if (hasSelection()) return
                          setPressed(null)
                          void connect(item.name)
                        }}
                      >
                        <text fg={theme().primary}>save</text>
                      </box>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
