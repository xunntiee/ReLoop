import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [rootPackagePath, serverPackagePath, destinationPath] =
  process.argv.slice(2);

if (!(rootPackagePath && serverPackagePath && destinationPath)) {
  throw new Error(
    "Usage: node build-portable-runtime-package.mjs <root-package.json> <server-package.json> <destination>"
  );
}

const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const serverPackage = JSON.parse(readFileSync(serverPackagePath, "utf8"));
const catalog = rootPackage?.workspaces?.catalog ?? {};
const runtimeDependencies = {};

for (const [name, requestedVersion] of Object.entries(
  serverPackage.dependencies ?? {}
)) {
  if (name === "@tool-base/config" || requestedVersion === "workspace:*") {
    continue;
  }

  if (name === "playwright") {
    try {
      const installedPackage = JSON.parse(
        readFileSync(
          join(
            dirname(serverPackagePath),
            "node_modules",
            name,
            "package.json"
          ),
          "utf8"
        )
      );
      if (installedPackage.version) {
        runtimeDependencies[name] = String(installedPackage.version);
        continue;
      }
    } catch {
      // Fall back to the version declared by the server package.
    }
  }

  if (requestedVersion === "catalog:") {
    const catalogVersion = catalog[name];
    if (!catalogVersion) {
      throw new Error(`Missing workspace catalog version for ${name}`);
    }
    runtimeDependencies[name] = catalogVersion;
    continue;
  }

  runtimeDependencies[name] = requestedVersion;
}

const runtimePackage = {
  name: "post-to-video-local-web-runtime",
  private: true,
  version: "1.0.0",
  type: "module",
  dependencies: runtimeDependencies,
};

writeFileSync(
  destinationPath,
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
  "utf8"
);
