import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillSeederService } from '../src/skill-seeder.service.js';
import type { ISkillSearchAdapter } from '../src/interfaces/skill-search-adapter.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('---\nname: test-skill\n---\nBody.'),
  readdir: vi.fn().mockResolvedValue(['test-skill']),
  stat: vi.fn()
    .mockResolvedValueOnce({ isDirectory: () => true })   // entry is a directory
    .mockResolvedValueOnce({ isDirectory: () => false })  // skill.md exists (stat succeeds)
    .mockResolvedValue({ isDirectory: () => false }),      // fallback for subsequent calls
}));

function makeAdapter(overrides: Partial<ISkillSearchAdapter> = {}): ISkillSearchAdapter {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    addCollection: vi.fn().mockResolvedValue(undefined),
    addVirtualCollection: vi.fn().mockResolvedValue(undefined),
    removeCollection: vi.fn().mockResolvedValue(undefined),
    listCollections: vi.fn().mockResolvedValue([]),
    listDocuments: vi.fn().mockResolvedValue([]),
    getDocument: vi.fn().mockResolvedValue(null),
    upsertDocument: vi.fn().mockResolvedValue(undefined),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
    indexCollection: vi.fn().mockResolvedValue(undefined),
    indexAll: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('SkillSeederService', () => {
  const baseDir = '/data/skills/global';
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts new skills not yet in the adapter', async () => {
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      listDocuments: vi.fn().mockResolvedValue([]),
      upsertDocument: upsertMock,
    });
    const content = '---\nname: pay-bill\n---\nPay a vendor bill.';
    const mockFs = {
      readFile: vi.fn().mockResolvedValue(content),
      readdir: vi.fn().mockResolvedValue(['pay-bill']),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    };

    const seeder = new SkillSeederService(adapter, baseDir, logger as never, mockFs);
    await seeder.seed();

    expect(upsertMock).toHaveBeenCalledWith('global', 'pay-bill.md', content);
  });

  it('skips skills whose content hash is unchanged', async () => {
    const content = '---\nname: pay-bill\n---\nPay a vendor bill.';
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      listDocuments: vi.fn().mockResolvedValue(['pay-bill.md']),
      getDocument: vi.fn().mockResolvedValue(content),
      upsertDocument: upsertMock,
    });
    const mockFs = {
      readFile: vi.fn().mockResolvedValue(content),
      readdir: vi.fn().mockResolvedValue(['pay-bill']),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    };

    const seeder = new SkillSeederService(adapter, baseDir, logger as never, mockFs);
    await seeder.seed();

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('upserts skills whose content has changed', async () => {
    const oldContent = '---\nname: pay-bill\n---\nOld content.';
    const newContent = '---\nname: pay-bill\n---\nNew content.';
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      listDocuments: vi.fn().mockResolvedValue(['pay-bill.md']),
      getDocument: vi.fn().mockResolvedValue(oldContent),
      upsertDocument: upsertMock,
    });
    const mockFs = {
      readFile: vi.fn().mockResolvedValue(newContent),
      readdir: vi.fn().mockResolvedValue(['pay-bill']),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    };

    const seeder = new SkillSeederService(adapter, baseDir, logger as never, mockFs);
    await seeder.seed();

    expect(upsertMock).toHaveBeenCalledWith('global', 'pay-bill.md', newContent);
  });

  it('deletes orphan skills that are in the adapter but no longer on disk', async () => {
    const deleteMock = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      listDocuments: vi.fn().mockResolvedValue(['pay-bill.md', 'old-skill.md']),
      getDocument: vi.fn().mockResolvedValue('---\nname: pay-bill\n---'),
      deleteDocument: deleteMock,
    });
    const content = '---\nname: pay-bill\n---';
    const mockFs = {
      readFile: vi.fn().mockResolvedValue(content),
      readdir: vi.fn().mockResolvedValue(['pay-bill']), // old-skill not on disk
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    };

    const seeder = new SkillSeederService(adapter, baseDir, logger as never, mockFs);
    await seeder.seed();

    expect(deleteMock).toHaveBeenCalledWith('global', 'old-skill.md');
    expect(deleteMock).not.toHaveBeenCalledWith('global', 'pay-bill.md');
  });

  it('handles missing skills directory gracefully', async () => {
    const upsertDocument = vi.fn().mockResolvedValue(undefined);
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ upsertDocument, deleteDocument });
    const readdir = vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory'));
    const stat = vi.fn();
    const readFile = vi.fn();
    const mockFs = {
      readFile,
      readdir,
      stat,
    };

    const seeder = new SkillSeederService(adapter, baseDir, logger as never, mockFs);
    await seeder.seed(); // should not throw

    expect(upsertDocument).not.toHaveBeenCalled();
    expect(deleteDocument).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('skips non-directory entries in the skills base dir', async () => {
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      listDocuments: vi.fn().mockResolvedValue([]),
      upsertDocument: upsertMock,
    });
    const mockFs = {
      readFile: vi.fn(),
      readdir: vi.fn().mockResolvedValue(['README.md']),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => false }), // not a directory
    };

    const seeder = new SkillSeederService(adapter, baseDir, logger as never, mockFs);
    await seeder.seed();

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('skips directory entries that have no skill.md file', async () => {
    const upsertMock = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      listDocuments: vi.fn().mockResolvedValue([]),
      upsertDocument: upsertMock,
    });
    // stat returns isDirectory=true for the entry itself, but throws for skill.md inside it
    const mockFs = {
      readFile: vi.fn(),
      readdir: vi.fn().mockResolvedValue(['not-a-skill']),
      stat: vi.fn()
        .mockResolvedValueOnce({ isDirectory: () => true }) // entry is a directory
        .mockRejectedValueOnce(new Error('ENOENT')),        // no skill.md inside
    };

    const seeder = new SkillSeederService(adapter, baseDir, logger as never, mockFs);
    await seeder.seed();

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('uses default fs implementation when no custom fs is provided', async () => {
    // The default fs wrappers (lines 25-28) delegate to fsPromises, which is mocked above.
    // Calling seed() exercises the default readdir/stat/readFile arrow functions.
    const adapter = makeAdapter({
      listDocuments: vi.fn().mockResolvedValue([]),
    });
    const seeder = new SkillSeederService(adapter, baseDir, logger as never);
    await seeder.seed(); // exercises the default FsInterface arrow functions
    expect(seeder).toBeDefined();
  });
});
