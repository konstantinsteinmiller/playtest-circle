import type { Env } from '../env'
import { B2Driver } from './b2'
import { LocalDriver } from './local'
import type { StorageDriver } from './types'

export function storage(env: Env, origin: string): StorageDriver {
  return env.STORAGE_DRIVER === 'b2' ? new B2Driver(env) : new LocalDriver(env, origin)
}

export type { StorageDriver, UploadedPart } from './types'
