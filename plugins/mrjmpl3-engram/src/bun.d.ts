declare const Bun: {
  file(path: string): {
    exists(): Promise<boolean>;
  };
  spawn(command: string[], options?: Record<string, unknown>): unknown;
  spawnSync(command: string[]): {
    exitCode: number;
    stdout?: { toString(): string };
  };
  which(command: string): string | null;
};
