/** Test-only atomic CAS transport. Runs the real state transitions, no production connection. */
export function memoryGateRedis() {
  const values = new Map<string, string>();
  return {
    values,
    async get(key: string) { return values.get(key) ?? null; },
    async eval(_script: string, _keys: number, key: string, previous: string, next: string) {
      if ((values.get(key) ?? "") !== previous) return 0;
      values.set(key, next);
      return 1;
    },
  };
}
