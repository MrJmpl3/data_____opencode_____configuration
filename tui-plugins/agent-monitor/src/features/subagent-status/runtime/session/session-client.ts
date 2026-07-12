import { isRecord } from '../../../../kit/coercion.ts';

// Timeout applied to every session-client API call. 15s is generous: it lets
// the API respond even under load (message reads, status maps across long
// sessions) but prevents any single call from freezing the refresh worker.
// The timeout is a safety net — the existing catch blocks in callers
// (hydrate-client.ts, orchestrator.ts) already handle failures gracefully.
const SESSION_CLIENT_TIMEOUT_MS = 15_000;

type SessionStatusMap = Record<string, unknown>;

class SessionClientTimeout extends Error {
  constructor(ms: number) {
    super(`Session client timed out after ${ms}ms`);
    this.name = 'SessionClientTimeout';
  }
}

const timeoutRace = <T>(call: () => Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SessionClientTimeout(ms)), ms);
    call().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

export type SessionClientBoundaryApi = {
  client: {
    session?: {
      children?: (input: { sessionID: string; directory: string }) => Promise<unknown>;
      status?: (input: { directory: string }) => Promise<{ data?: unknown } | undefined>;
      messages?: (input: { sessionID: string; directory: string }) => Promise<{ data?: unknown } | undefined>;
    };
  };
  state: {
    path: {
      directory: string;
    };
  };
};

const normalizeStatusMap = (input: unknown): SessionStatusMap => (isRecord(input) ? input : {});

const normalizeMessages = (input: unknown): readonly unknown[] => (Array.isArray(input) ? input : []);

const withTimeout = <T>(call: () => Promise<T>, ms: number): Promise<T> => timeoutRace(call, ms);

export const createSessionClientBoundary = (
  api: SessionClientBoundaryApi,
  sessionClientTimeoutMs: number = SESSION_CLIENT_TIMEOUT_MS,
) => {
  const directory = api.state.path.directory;
  const sessionClient = api.client.session;

  return {
    listChildren: async (sessionID: string): Promise<unknown> =>
      withTimeout(
        () => sessionClient?.children?.({ sessionID, directory }) ?? Promise.resolve(undefined),
        sessionClientTimeoutMs,
      ),
    readStatusMap: async (): Promise<SessionStatusMap> =>
      withTimeout(
        () => sessionClient?.status?.({ directory }).then((r) => normalizeStatusMap(r?.data)) ?? Promise.resolve({}),
        sessionClientTimeoutMs,
      ),
    readMessages: async (sessionID: string): Promise<readonly unknown[]> =>
      withTimeout(
        () =>
          sessionClient?.messages?.({ sessionID, directory }).then((r) => normalizeMessages(r?.data)) ??
          Promise.resolve([]),
        sessionClientTimeoutMs,
      ),
  };
};
