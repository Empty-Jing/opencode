import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { syncLocalAutoUpdateBinary } from "../../src/cli/upgrade"

describe("cli auto upgrade", () => {
  test("skips replacement when local binary md5 matches current binary", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source-opencode")
    const target = path.join(tmp.path, "target-opencode")
    const body = "#!/bin/sh\necho 1.2.3\n"

    await fs.writeFile(source, body, { mode: 0o755 })
    await fs.writeFile(target, body, { mode: 0o750 })
    await fs.chmod(source, 0o755)
    await fs.chmod(target, 0o750)

    const result = await syncLocalAutoUpdateBinary({ source, target })

    expect(result.available).toBe(false)
    expect(result.updated).toBe(false)
    expect(await fs.readFile(target, "utf8")).toBe(body)
  })

  test("replaces current binary from local source and preserves target mode", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source-opencode")
    const target = path.join(tmp.path, "target-opencode")
    const sourceBody = "#!/bin/sh\necho 9.9.9\n"
    const targetBody = "#!/bin/sh\necho 1.0.0\n"

    await fs.writeFile(source, sourceBody, { mode: 0o755 })
    await fs.writeFile(target, targetBody, { mode: 0o750 })
    await fs.chmod(source, 0o755)
    await fs.chmod(target, 0o750)

    const result = await syncLocalAutoUpdateBinary({ source, target })
    const stat = await fs.stat(target)

    expect(result.available).toBe(true)
    expect(result.updated).toBe(true)
    expect(result.version).toBe("9.9.9")
    expect(await fs.readFile(target, "utf8")).toBe(sourceBody)
    expect(stat.mode & 0o777).toBe(0o750)
  })

  test("notify mode only reports update and does not replace current binary", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source-opencode")
    const target = path.join(tmp.path, "target-opencode")
    const sourceBody = "#!/bin/sh\necho 2.0.0\n"
    const targetBody = "#!/bin/sh\necho 1.0.0\n"

    await fs.writeFile(source, sourceBody, { mode: 0o755 })
    await fs.writeFile(target, targetBody, { mode: 0o750 })
    await fs.chmod(source, 0o755)
    await fs.chmod(target, 0o750)

    const result = await syncLocalAutoUpdateBinary({ source, target, notify: true })

    expect(result.available).toBe(true)
    expect(result.updated).toBe(false)
    expect(result.version).toBe("2.0.0")
    expect(await fs.readFile(target, "utf8")).toBe(targetBody)
  })
})
