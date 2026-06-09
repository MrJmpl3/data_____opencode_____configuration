export interface ShellResult {
  stdout: { toString(): string } | string;
}

export interface ShellCommand extends PromiseLike<unknown> {
  quiet(): ShellCommand;
  nothrow(): Promise<ShellResult>;
}

export type ShellExecutor = (strings: TemplateStringsArray, ...values: string[]) => ShellCommand;
