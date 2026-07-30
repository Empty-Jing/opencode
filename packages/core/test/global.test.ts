import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "./fixture/tmpdir"

describe("global paths", () => {
  test("tmp path is exposed by the global service", () => {
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  if (process.platform !== "linux") {
    test("tmp path is under the system temp directory", () => {
      expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "opencode"))
    })
  }
})

const describeLinux = process.platform === "linux" ? describe : describe.skip

describeLinux("linux runtime path", () => {
  test("uses a valid XDG runtime directory", async () => {
    await using root = await tmpdir()
    const runtime = path.join(root.path, "runtime")
    await fs.mkdir(runtime, { mode: 0o700 })

    const result = await resolveTmp(runtime, root.path)

    expect(result).toBe(path.join(runtime, "opencode"))
    expect((await fs.stat(result)).mode & 0o777).toBe(0o700)
  })

  test("falls back when XDG_RUNTIME_DIR is unset or empty", async () => {
    await using root = await tmpdir()
    const fallback = `/tmp/opencode-${linuxUid()}`

    expect(await resolveTmp(undefined, root.path)).toBe(fallback)
    expect(await resolveTmp("", root.path)).toBe(fallback)
  })

  test("falls back when XDG_RUNTIME_DIR is relative or missing", async () => {
    await using root = await tmpdir()
    const fallback = `/tmp/opencode-${linuxUid()}`

    expect(await resolveTmp("runtime", root.path)).toBe(fallback)
    expect(await resolveTmp(path.join(root.path, "missing"), root.path)).toBe(fallback)
  })

  test("falls back when XDG_RUNTIME_DIR is not secure", async () => {
    await using root = await tmpdir()
    const runtime = path.join(root.path, "runtime")
    await fs.mkdir(runtime, { mode: 0o700 })
    await fs.chmod(runtime, 0o755)

    expect(await resolveTmp(runtime, root.path)).toBe(`/tmp/opencode-${linuxUid()}`)
  })

  test("falls back when the XDG application directory is not secure", async () => {
    await using root = await tmpdir()
    const runtime = path.join(root.path, "runtime")
    await fs.mkdir(path.join(runtime, "opencode"), { recursive: true, mode: 0o700 })
    await fs.chmod(path.join(runtime, "opencode"), 0o755)

    expect(await resolveTmp(runtime, root.path)).toBe(`/tmp/opencode-${linuxUid()}`)
  })
})

async function resolveTmp(runtime: string | undefined, root: string) {
  const env = {
    ...process.env,
    XDG_RUNTIME_DIR: runtime,
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
  if (runtime === undefined) delete env.XDG_RUNTIME_DIR

  const proc = Bun.spawn([process.execPath, "-e", 'import { Global } from "./src/global.ts"; console.log(Global.Path.tmp)'], {
    cwd: path.join(import.meta.dir, ".."),
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(stderr)
  return stdout.trim()
}

function linuxUid() {
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error("Cannot determine Linux user ID")
  return uid
}
