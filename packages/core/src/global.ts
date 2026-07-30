import path from "path"
import fs from "fs/promises"
import { constants } from "fs"
import { xdgData, xdgCache, xdgConfig, xdgState, xdgRuntime } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"
import { makeGlobalNode } from "./effect/app-node"

const app = "opencode"
const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)
const tmp = await resolveTmp()

const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
  fs.mkdir(Path.repos, { recursive: true }),
])

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.OPENCODE_CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

async function resolveTmp() {
  if (process.platform !== "linux") {
    const directory = path.join(os.tmpdir(), app)
    await fs.mkdir(directory, { recursive: true })
    return directory
  }

  const uid = process.getuid?.()
  if (uid === undefined) throw new Error("OpenCode cannot determine the current Linux user ID")

  if (xdgRuntime && path.isAbsolute(xdgRuntime) && (await isSecureDirectory(xdgRuntime, uid))) {
    const directory = path.join(xdgRuntime, app)
    if (await ensureSecureDirectory(directory, uid)) return directory
  }

  const directory = path.join("/tmp", `${app}-${uid}`)
  if (await ensureSecureDirectory(directory, uid)) return directory
  throw new Error(`OpenCode runtime directory is not secure: ${directory}`)
}

async function ensureSecureDirectory(directory: string, uid: number) {
  const created = await fs
    .mkdir(directory, { recursive: true, mode: 0o700 })
    .then(() => true)
    .catch(() => false)
  return created && isSecureDirectory(directory, uid)
}

async function isSecureDirectory(directory: string, uid: number) {
  const stat = await fs.stat(directory).catch(() => undefined)
  if (!stat?.isDirectory()) return false
  if (stat.uid !== uid) return false
  if ((stat.mode & 0o777) !== 0o700) return false
  return fs
    .access(directory, constants.R_OK | constants.W_OK | constants.X_OK)
    .then(() => true)
    .catch(() => false)
}

export * as Global from "./global"
