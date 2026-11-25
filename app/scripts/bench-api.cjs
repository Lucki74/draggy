// Shared by the engine benches: turns on the app's local API server and returns its endpoint and key.
// The key stays in the caller's memory and is never logged.
async function enableApi(page, port) {
  const status = await page.evaluate(async (wanted) => {
    const api = window.draggy?.apiServer;
    if (!api) throw new Error("the app has no apiServer bridge");
    await api.configure({ enabled: true, port: wanted });
    return api.status();
  }, port);
  if (!status.running || !status.key) throw new Error(`API server not running: ${status.error ?? "no key"}`);
  return { baseUrl: status.baseUrl, key: status.key };
}

module.exports = { enableApi };
