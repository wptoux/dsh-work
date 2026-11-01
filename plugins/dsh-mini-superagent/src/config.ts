import s from '@deepseek-ai/schemastery'

export const Config = s.object({
  stateDir: s.string().pattern(/^\//).required().description('Absolute directory for the database, workspace and ticket folders.'),
  maxWorkers: s.number().min(1).max(4).step(1).default(1).description('Concurrent worker sessions.'),
  workerPreset: s.string().default('standard').description('DSH agent preset used by worker sessions.'),
})

export type MiniConfig = ReturnType<typeof Config>
