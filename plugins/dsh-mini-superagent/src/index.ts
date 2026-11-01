import type { Context } from '@deepseek-ai/cordis'
import { Config, type MiniConfig } from './config.ts'

export const name = 'mini-superagent'
export const inject = ['agents', 'sessionController', 'workspaceRegistry', 'tools', 'webServer']
export { Config }

export function apply(_ctx: Context, _config: MiniConfig): void {
  // Tasks 2–6 fill this in.
}
