import { execFile } from 'node:child_process';

export async function refreshSkillRegistry(directory: string): Promise<void> {
  await new Promise<void>((resolve) => {
    execFile(
      'gentle-ai',
      ['skill-registry', 'refresh', '--quiet', '--no-gitignore', '--cwd', directory],
      { timeout: 10_000 },
      (error) => {
        if (error) {
          console.error('mrjmpl3-skill-registry: failed to refresh skill registry', error);
        }

        resolve();
      },
    );
  });
}
