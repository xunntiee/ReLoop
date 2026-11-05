import { getChromiumLaunchHealth } from "../../apps/server/src/modules/crawl/browser-launch";

const { chromium } = await import("../../apps/server/node_modules/playwright/index.js");

const executablePath = "";
const channel = "chrome";

const crawlHealth = await getChromiumLaunchHealth(chromium, {
  channel,
  executablePath,
  headless: true,
  timeout: 8_000,
});

const loginHealth = await getChromiumLaunchHealth(chromium, {
  channel,
  executablePath,
  headless: false,
  timeout: 8_000,
});

console.log(
  JSON.stringify(
    {
      crawl: crawlHealth,
      login: loginHealth,
    },
    null,
    2,
  ),
);
