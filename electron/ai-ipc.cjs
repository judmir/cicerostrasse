function registerAIHandlers({ ipcMain, runner, publicError, allowedSender }) {
  const trusted = (event) => allowedSender(event.sender) && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle('ai:status', (event) => trusted(event) ? runner.status() : { configured: false });
  ipcMain.handle('ai:restyle', async (event, input) => {
    if (!trusted(event)) return { error: { code: 'forbidden', message: 'Only the app can use this backend.' } };
    const sender = event.sender;
    const cancel = () => runner.cancel(sender);
    sender.once('destroyed', cancel);
    sender.once('render-process-gone', cancel);
    sender.once('did-start-navigation', cancel);
    try {
      const result = await runner.start(input, { owner: sender, onProgress(stage) {
        if (!sender.isDestroyed()) sender.send('ai:progress', { requestId: input.requestId, stage });
      } });
      return { result };
    } catch (error) { return { error: publicError(error) }; }
    finally {
      sender.removeListener('destroyed', cancel); sender.removeListener('render-process-gone', cancel); sender.removeListener('did-start-navigation', cancel);
    }
  });
  ipcMain.on('ai:cancel', (event, requestId) => { if (trusted(event)) runner.cancel(event.sender, requestId); });
}
module.exports = { registerAIHandlers };
