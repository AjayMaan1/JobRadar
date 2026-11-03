import { FakeRedis } from '../../fake-redis.js'
/** ioredis double: an in-memory FakeRedis per process (shared by everything that constructs a client). */
let shared: FakeRedis | null = null
export default class Redis {
  constructor(..._a: any[]) { return (shared ??= new FakeRedis()) as unknown as Redis }
  static shared(): FakeRedis { return (shared ??= new FakeRedis()) }
}
