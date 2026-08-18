// Simulates a connector that crashes the process before ever responding.
process.on('message', () => {
  process.exit(1);
});
