export function extractProjectName(directory: string): string {
  try {
    const result = Bun.spawnSync(['git', '-C', directory, 'remote', 'get-url', 'origin']);
    if (result.exitCode === 0) {
      const url = result.stdout?.toString().trim();
      if (url) {
        const name = url
          .replace(/\.git$/, '')
          .split(/[/:]/)
          .pop();
        if (name) {
          return name;
        }
      }
    }
  } catch {}

  try {
    const result = Bun.spawnSync(['git', '-C', directory, 'rev-parse', '--show-toplevel']);
    if (result.exitCode === 0) {
      const root = result.stdout?.toString().trim();
      if (root) {
        return root.split('/').pop() ?? 'unknown';
      }
    }
  } catch {}

  return directory.split('/').pop() ?? 'unknown';
}
