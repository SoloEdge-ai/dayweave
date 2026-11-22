import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const serverScript = fileURLToPath(new URL('./serve.py', import.meta.url))

export async function fixture() {
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const server = spawn(process.env.DAYWEAVE_TEST_PYTHON || 'python', [serverScript, '--port', String(port)], {
    stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  })
  const lines = createInterface({ input: server.stdout })
  const stop = () => { if (!server.stdin.destroyed) server.stdin.end() }
  process.once('exit', stop)
  const url = 'http://127.0.0.1:' + port
  try {
    for await (const line of lines) {
      if (!line.startsWith('DAYWEAVE_FIXTURE=')) continue
      const { password } = JSON.parse(await readFile(line.slice('DAYWEAVE_FIXTURE='.length), 'utf8'))
      for (let i = 0; i < 100; i++) {
        if ((await fetch(url + '/api/health').catch(() => null))?.ok) {
          return { url, password, stop }
        }
        await delay(100)
      }
      throw new Error('The fixture failed its health check.')
    }
    throw new Error('The fixture exited before startup.')
  } catch (error) {
    stop()
    throw error
  }
}

export async function call(request, method, path, data) {
  const response = await request.fetch('/api' + path, { method, data })
  if (!response.ok()) throw new Error(method + ' ' + path + ': ' + await response.text())
  return response.status() === 204 ? null : response.json()
}
