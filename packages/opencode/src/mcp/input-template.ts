import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"

export type ResolvedConfig = Omit<ConfigMCPV1.Local, "inputs"> | Omit<ConfigMCPV1.Remote, "inputs">

export interface MissingInputValue {
  readonly key: string
}

export class MissingInputValueError extends Error {
  readonly key: string

  constructor(input: MissingInputValue) {
    super(`Missing MCP input value for \"${input.key}\"`)
    this.name = "MissingInputValueError"
    this.key = input.key
  }
}

const INPUT_PATTERN = /\{input:([^}]+)\}/g

function resolveString(value: string, inputs: Record<string, string>) {
  return value.replace(INPUT_PATTERN, (_, key: string) => {
    if (!(key in inputs)) throw new MissingInputValueError({ key })
    return inputs[key]
  })
}

function resolveValue(value: unknown, inputs: Record<string, string>): unknown {
  if (typeof value === "string") return resolveString(value, inputs)
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, inputs))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, inputs)]))
}

export function resolveMcpInputs(
  config: ConfigMCPV1.Info & {
    inputs?: unknown
  },
  inputs: Record<string, string>,
): ResolvedConfig {
  const { inputs: _inputs, ...rest } = config
  return resolveValue(rest, inputs) as ResolvedConfig
}

export * as McpInputTemplate from "./input-template"
