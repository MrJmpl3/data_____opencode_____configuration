declare const Bun: {
  file(path: string): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
  };
  spawn(
    command: string[],
    options?: Record<string, unknown>,
  ): {
    exited: Promise<number>;
    kill(): void;
    stdout: BodyInit;
  };
  write(path: string, contents: string): Promise<void>;
};
