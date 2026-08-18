process.on('message', () => {
  process.send?.({ ok: true, text: 'fixture success' }, () => process.exit(0));
});
