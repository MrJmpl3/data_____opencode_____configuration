import { writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type { ModelVariants } from './types.ts';

export function getVariantsCachePath(homeDirectory = homedir()): string {
  return path.join(homeDirectory, '.gentle-ai', 'cache', 'model-variants.json');
}

export async function writeVariantsCache(variants: ModelVariants, finalPath = getVariantsCachePath()): Promise<void> {
  await mkdir(path.dirname(finalPath), { recursive: true });

  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(variants, null, 2));
  await rename(tmpPath, finalPath);
}
