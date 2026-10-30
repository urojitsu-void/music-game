interface ShutdownSupervisor {
  shutdown(): Promise<void>;
}

interface SignalTarget {
  exitCode?: string | number;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  removeListener(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export function installShutdownHandlers(
  supervisor: ShutdownSupervisor,
  target: SignalTarget = process,
): () => void {
  const handle = (exitCode: number) => {
    target.exitCode ??= exitCode;
    void supervisor.shutdown().catch(() => undefined);
  };
  const onInterrupt = () => { handle(130); };
  const onTerminate = () => { handle(143); };
  target.on('SIGINT', onInterrupt);
  target.on('SIGTERM', onTerminate);
  return () => {
    target.removeListener('SIGINT', onInterrupt);
    target.removeListener('SIGTERM', onTerminate);
  };
}
