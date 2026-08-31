import { createServer } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
createServer(config).listen(config.port, () => {
  console.log(`[mock-provider] listening on :${config.port}`);
});
