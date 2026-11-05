import { existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { TopicData } from "../types.js";
import { writeJsonFileAtomic } from "./output-file.js";

export class CrawlJsonWriter {
  constructor(private readonly outputDir: string) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeTopics(topics: TopicData[], filename: string): string {
    const path = this.resolveUniquePath(filename);
    writeJsonFileAtomic(path, topics);
    return path;
  }

  private resolveUniquePath(filename: string): string {
    const basePath = join(this.outputDir, filename);
    if (!existsSync(basePath)) {
      return basePath;
    }

    const extension = extname(filename);
    const stem = extension ? filename.slice(0, -extension.length) : filename;
    let attempt = 1;
    while (attempt < 10_000) {
      const nextPath = join(this.outputDir, `${stem}-${Date.now()}-${attempt}${extension}`);
      if (!existsSync(nextPath)) {
        return nextPath;
      }
      attempt += 1;
    }

    return join(this.outputDir, `${stem}-${process.pid}-${Date.now()}${extension}`);
  }
}
