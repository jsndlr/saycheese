/**
 * Minimal typing for Vite's `import.meta.glob` as used by the tests. The
 * backend does not depend on Vite directly; vitest provides the transform.
 */
interface ImportMeta {
  glob(pattern: string): Record<string, () => Promise<Record<string, unknown>>>;
}
