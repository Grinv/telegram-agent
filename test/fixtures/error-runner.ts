process.on('message', () => {
  process.send?.(
    { ok: false, reason: 'PROVIDER_ERROR', message: 'fixture provider error' },
    () => process.exit(1)
  );
});
