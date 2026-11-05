import {
  expandSeedTargetUrls,
  extractPostUrls,
} from "../../apps/server/src/modules/crawl/collectors/threads-url.ts";

const extracted = extractPostUrls(
  [
    "https://www.threads.com/@cormal.11/post/DacmLdZEc9U?xmt=AQG0Jlayj0HJXRcxOPjaM9Xhue9E0sXPOHhE5YzyQ4DS5w",
    "https://www.threads.com/share/GNxP2G0l-/",
    "https://www.threads.com/share/Fj3BUMon4/",
  ],
  "https://www.threads.com",
);

const expected = [
  "https://www.threads.com/@cormal.11/post/DacmLdZEc9U",
  "https://www.threads.com/share/GNxP2G0l-/",
  "https://www.threads.com/share/Fj3BUMon4/",
];

if (JSON.stringify(extracted) !== JSON.stringify(expected)) {
  throw new Error(
    `Expected Threads seed URLs ${JSON.stringify(expected)}, got ${JSON.stringify(extracted)}.`,
  );
}

const embedded = `<blockquote data-text-post-permalink="https://www.threads.com/@callme_thor20/post/DdS8zX4lLJU"><a href="https://www.threads.com/@callme_thor20/post/DdS8zX4lLJU">Xem trên Threads</a></blockquote><script src="https://www.threads.com/embed.js"></script>`;
const expanded = expandSeedTargetUrls([embedded], "https://www.threads.com");
const expectedEmbedded = [
  "https://www.threads.com/@callme_thor20/post/DdS8zX4lLJU",
];
if (JSON.stringify(expanded) !== JSON.stringify(expectedEmbedded)) {
  throw new Error(
    `Expected embedded Threads permalink ${JSON.stringify(expectedEmbedded)}, got ${JSON.stringify(expanded)}.`,
  );
}

const signedDirectSeed = expandSeedTargetUrls(
  [
    "https://www.threads.com/@jqklone/post/DdK8JePCcLK?xmt=AQG0g3mjqjnU36EOXUqnqDrf1WleS6QyT5-KopCMi77me6GRko_8osh2nAPmjZC_J2T8L9M",
    "https://www.threads.com/share/F2G13cPhn/",
  ],
  "https://www.threads.com",
);
const expectedSignedDirectSeed = [
  "https://www.threads.com/@jqklone/post/DdK8JePCcLK?xmt=AQG0g3mjqjnU36EOXUqnqDrf1WleS6QyT5-KopCMi77me6GRko_8osh2nAPmjZC_J2T8L9M",
  "https://www.threads.com/share/F2G13cPhn/",
];
if (JSON.stringify(signedDirectSeed) !== JSON.stringify(expectedSignedDirectSeed)) {
  throw new Error(
    `Expected direct seed URLs to preserve navigation query ${JSON.stringify(expectedSignedDirectSeed)}, got ${JSON.stringify(signedDirectSeed)}.`,
  );
}

console.log("threads-seed-url-support: ok");
