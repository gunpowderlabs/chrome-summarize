type TraceMessage = Record<string, unknown>;

const publisher = {
  publish: (_message: TraceMessage) => {},
};

const noopTracingChannel = {
  hasSubscribers: false,
  tracePromise: async <T>(
    execute: () => PromiseLike<T> | T,
    _message: TraceMessage
  ): Promise<T> => execute(),
  start: {
    runStores: <T>(_message: TraceMessage, execute: () => T): T => execute(),
  },
  end: publisher,
  error: publisher,
  asyncEnd: publisher,
};

export function tracingChannel() {
  return noopTracingChannel;
}

export default {
  tracingChannel,
};
