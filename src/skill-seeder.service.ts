import { createHash } from 'crypto';
import { join } from 'path';
import * as fsPromises from 'fs/promises';
import type { Logger } from './logger.js';
import type { ISkillSearchAdapter } from './interfaces/skill-search-adapter.js';

const GLOBAL_COLLECTION = 'global';

export interface FsInterface {
  readFile(path: string, encoding: 'utf-8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
}

export class SkillSeederService {
  private fs: FsInterface;

  constructor(
    private adapter: ISkillSearchAdapter,
    private skillsBaseDir: string,
    private logger: Logger,
    fs?: FsInterface,
  ) {
    this.fs = fs ?? {
      readFile: (p) => fsPromises.readFile(p, 'utf-8'),
      readdir: (p) => fsPromises.readdir(p),
      stat: (p) => fsPromises.stat(p),
    };
  }

  async seed(): Promise<void> {
    this.logger.info({ dir: this.skillsBaseDir }, 'Seeding global skills');

    const diskSkillNames = await this.scanDiskSkillNames();
    const adapterPaths = await this.adapter.listDocuments(GLOBAL_COLLECTION);
    const adapterSkillNames = new Set(adapterPaths.map((p) => p.replace(/\.md$/, '')));

    let upserted = 0;
    let skipped = 0;
    let deleted = 0;

    // Upsert new or changed skills
    for (const skillName of diskSkillNames) {
      const filePath = join(this.skillsBaseDir, skillName, 'skill.md');
      const content = await this.fs.readFile(filePath, 'utf-8');
      const existingContent = await this.adapter.getDocument(GLOBAL_COLLECTION, `${skillName}.md`);

      if (existingContent !== null) {
        const existingHash = createHash('sha256').update(existingContent).digest('hex');
        const newHash = createHash('sha256').update(content).digest('hex');
        if (existingHash === newHash) {
          skipped++;
          continue;
        }
      }

      await this.adapter.upsertDocument(GLOBAL_COLLECTION, `${skillName}.md`, content);
      upserted++;
    }

    // Delete orphans (in adapter but not on disk)
    const diskSet = new Set(diskSkillNames);
    for (const adapterSkillName of adapterSkillNames) {
      if (!diskSet.has(adapterSkillName)) {
        await this.adapter.deleteDocument(GLOBAL_COLLECTION, `${adapterSkillName}.md`);
        deleted++;
      }
    }

    this.logger.info({ upserted, skipped, deleted }, 'Global skills seeding complete');
  }

  private async scanDiskSkillNames(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await this.fs.readdir(this.skillsBaseDir);
    } catch {
      this.logger.warn({ dir: this.skillsBaseDir }, 'Global skills directory not found — skipping seed');
      return [];
    }

    const skillNames: string[] = [];
    for (const entry of entries) {
      const entryPath = join(this.skillsBaseDir, entry);
      const s = await this.fs.stat(entryPath);
      if (!s.isDirectory()) continue;
      const skillFilePath = join(entryPath, 'skill.md');
      try {
        await this.fs.stat(skillFilePath);
        skillNames.push(entry);
      } catch {
        // No skill.md in this directory — skip
      }
    }
    return skillNames;
  }
}
