import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import type { Field as McpInputField } from "@opencode-ai/core/v1/config/mcp-input"

export type InteractiveMcpConfig =
  | (ConfigMCPV1.Local & { inputs: McpInputField[] })
  | (ConfigMCPV1.Remote & { inputs: McpInputField[] })

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function parseField(value: unknown): McpInputField | undefined {
  if (!isRecord(value)) return
  if (typeof value.key !== "string" || !value.key) return
  const type = value.type === "password" ? "password" : value.type === "text" ? "text" : undefined
  return {
    key: value.key,
    label: typeof value.label === "string" ? value.label : undefined,
    type,
    required: typeof value.required === "boolean" ? value.required : undefined,
    default: typeof value.default === "string" ? value.default : undefined,
    placeholder: typeof value.placeholder === "string" ? value.placeholder : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
  }
}

function parseInputs(value: unknown): McpInputField[] | undefined {
  if (!Array.isArray(value)) return
  const result = value.flatMap((item) => {
    const field = parseField(item)
    return field ? [field] : []
  })
  return result.length ? result : undefined
}

export function getInteractiveMcpConfig(config: unknown, name: string): InteractiveMcpConfig | undefined {
  if (!isRecord(config)) return
  const mcp = config.mcp
  if (!isRecord(mcp)) return
  const entry = mcp[name]
  if (!isRecord(entry)) return

  const inputs = parseInputs(entry.inputs)
  if (!inputs?.length) return

  if (
    entry.type === "local" &&
    Array.isArray(entry.command) &&
    entry.command.every((item) => typeof item === "string")
  ) {
    return {
      ...(entry as ConfigMCPV1.Local),
      inputs,
    }
  }

  if (entry.type === "remote" && typeof entry.url === "string") {
    return {
      ...(entry as ConfigMCPV1.Remote),
      inputs,
    }
  }
}

export * as TuiMcpInteractive from "./interactive"
