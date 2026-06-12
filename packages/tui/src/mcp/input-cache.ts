import path from "path"
import { Global } from "@opencode-ai/core/global"

export interface McpInputCacheData {
  readonly version: 1
  readonly values: Record<string, string>
}

let cachePromise: Promise<McpInputCacheData> | undefined
let writePromise = Promise.resolve()

function filePath() {
  return path.join(Global.Path.state, "mcp-inputs.json")
}

async function load() {
  try {
    const data = (await Bun.file(filePath()).json()) as Partial<McpInputCacheData>
    return {
      version: 1 as const,
      values: typeof data.values === "object" && data.values ? data.values : {},
    }
  } catch {
    return {
      version: 1 as const,
      values: {},
    }
  }
}

async function state() {
  cachePromise ??= load()
  return cachePromise
}

function makeKey(workspace: string, name: string, field: string) {
  return `${workspace}:${name}:${field}`
}

export async function get(workspace: string, name: string, field: string) {
  const data = await state()
  return data.values[makeKey(workspace, name, field)]
}

export async function set(workspace: string, name: string, field: string, value: string) {
  const data = await state()
  const key = makeKey(workspace, name, field)
  if (value) data.values[key] = value
  else delete data.values[key]

  writePromise = writePromise
    .then(() => Bun.write(filePath(), JSON.stringify(data, null, 2)).then(() => {}))
    .catch((error) => {
      console.error("Failed to write MCP input cache", { filePath: filePath(), error })
    })
  await writePromise
}

export async function reset() {
  cachePromise = undefined
  writePromise = Promise.resolve()
}

export * as TuiMcpInputCache from "./input-cache"
