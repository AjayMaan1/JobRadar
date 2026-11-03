export default class PQueue { constructor(_o?: any) {} add<T>(fn: () => Promise<T>): Promise<T> { return fn() } }
