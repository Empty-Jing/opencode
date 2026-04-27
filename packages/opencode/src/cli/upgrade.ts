import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { GlobalBus } from "@/bus/global"
import { createHash } from "node:crypto"
import fs from "fs/promises"
import path from "path"

const AUTOUPDATE_BINARY = "/usr/local/opencode/opencode"

export async function syncLocalAutoUpdateBinary(input: { source: string; target: string; notify?: boolean }) {
  if (input.source === input.target) {
    return { available: false, updated: false, version: InstallationVersion }
  }

  const [sourceExists, targetExists] = await Promise.all([
    fs.access(input.source).then(() => true).catch(() => false),
    fs.access(input.target).then(() => true).catch(() => false),
  ])
  if (!sourceExists || !targetExists) {
    return { available: false, updated: false, version: InstallationVersion }
  }

  const version = await readBinaryVersion(input.source).catch(() => InstallationVersion)
  const [sourceHash, targetHash] = await Promise.all([md5(input.source), md5(input.target)])
  if (sourceHash === targetHash) {
    return { available: false, updated: false, version }
  }
  if (input.notify) {
    return { available: true, updated: false, version }
  }

  const stat = await fs.stat(input.target)
  const temp = path.join(path.dirname(input.target), `.${path.basename(input.target)}.autoupdate-${process.pid}`)
  await fs.rm(temp, { force: true }).catch(() => {})
  try {
    await fs.copyFile(input.source, temp)
    await fs.chmod(temp, stat.mode)
    if (process.platform !== "win32") await fs.chown(temp, stat.uid, stat.gid).catch(() => {})
    await fs.rename(temp, input.target)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {})
  }

  return { available: true, updated: true, version }
}

async function md5(file: string) {
  return createHash("md5").update(Buffer.from(await Bun.file(file).arrayBuffer())).digest("hex")
}

async function readBinaryVersion(file: string) {
  const proc = Bun.spawn([file, "--version"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const output = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  const hit = output.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)
  return hit?.[0] ?? InstallationVersion
}

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if ((config.autoupdate !== true && config.autoupdate !== "notify") || Flag.OPENCODE_DISABLE_AUTOUPDATE) return
  const result = await syncLocalAutoUpdateBinary({
    source: Flag.OPENCODE_AUTOUPDATE_BINARY ?? AUTOUPDATE_BINARY,
    target: process.execPath,
    notify: config.autoupdate === "notify" || Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE,
  }).catch(() => undefined)
  if (!result?.available) return

  if (!result.updated) {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: result.version },
      },
    })
    return
  }

  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Installation.Event.Updated.type,
      properties: { version: result.version },
    },
  })
}
