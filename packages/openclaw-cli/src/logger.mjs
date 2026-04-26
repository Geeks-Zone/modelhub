const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function resolveConsoleMethod(lvl) {
  if (lvl === 'error') return 'error';
  if (lvl === 'warn') return 'warn';
  return 'log';
}

export function createLogger(level = 'error') {
  const numeric = LEVELS[level] ?? 0;

  function emit(lvl, prefix, args) {
    if (LEVELS[lvl] > numeric) return;
    const method = resolveConsoleMethod(lvl);
    const tag = prefix ? `[${prefix}]` : '';
    console[method](tag, ...args);
  }

  return {
    debug: (...args) => emit('debug', 'debug', args),
    error: (...args) => emit('error', 'error', args),
    info: (...args) => emit('info', 'info', args),
    warn: (...args) => emit('warn', 'warn', args),
  };
}

export function resolveLogLevel(flags) {
  if (flags.debug) return 'debug';
  if (flags.verbose) return 'info';
  return 'error';
}
