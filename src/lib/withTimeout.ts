/** Race a promise against a timer; clears the timer when the promise settles first. */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, onTimeout: string): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(onTimeout)), ms)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (id !== undefined) clearTimeout(id)
  })
}
