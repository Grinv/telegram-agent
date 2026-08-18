// Intentionally never responds, to simulate a hung inference call for the
// inference-caller timeout test. The open IPC channel keeps this process
// alive until the parent kills it.
process.on('message', () => {
  // no-op
});
