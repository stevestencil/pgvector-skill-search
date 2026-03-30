import { describe, it, expect } from 'vitest';
import { parseSkillFrontmatter, extractSkillTitle } from '../src/parse-frontmatter.js';

describe('parseSkillFrontmatter', () => {
  it('parses all fields from inline-array frontmatter', () => {
    const content = `---
name: record-sale
tags: [sale, revenue, income]
triggers: [record a sale, customer paid]
globalCandidate: true
createdBy: developer
---
Body text.`;
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('record-sale');
    expect(result.tags).toEqual(['sale', 'revenue', 'income']);
    expect(result.triggers).toEqual(['record a sale', 'customer paid']);
    expect(result.globalCandidate).toBe(true);
    expect(result.createdBy).toBe('developer');
  });

  it('parses multi-line YAML array syntax', () => {
    const content = `---
name: pay-bill
tags:
  - accounts payable
  - vendor payment
triggers:
  - pay a vendor
  - bill payment
---`;
    const result = parseSkillFrontmatter(content);
    expect(result.tags).toEqual(['accounts payable', 'vendor payment']);
    expect(result.triggers).toEqual(['pay a vendor', 'bill payment']);
  });

  it('returns defaults when no frontmatter block present', () => {
    const result = parseSkillFrontmatter('Just plain text with no frontmatter.');
    expect(result.name).toBe('');
    expect(result.tags).toEqual([]);
    expect(result.triggers).toEqual([]);
    expect(result.globalCandidate).toBe(false);
    expect(result.createdBy).toBe('developer');
  });

  it('defaults createdBy to "developer" for unknown values', () => {
    const content = `---\ncreatedBy: unknown-value\n---`;
    const result = parseSkillFrontmatter(content);
    expect(result.createdBy).toBe('developer');
  });

  it('parses createdBy: ai', () => {
    const content = `---\ncreatedBy: ai\n---`;
    expect(parseSkillFrontmatter(content).createdBy).toBe('ai');
  });

  it('parses createdBy: user', () => {
    const content = `---\ncreatedBy: user\n---`;
    expect(parseSkillFrontmatter(content).createdBy).toBe('user');
  });

  it('skips frontmatter lines without a colon (e.g. blank lines)', () => {
    // A blank line in the frontmatter block has no colon — should be skipped gracefully
    const content = `---\nname: record-sale\n\ntags: [sale]\n---\nBody.`;
    const result = parseSkillFrontmatter(content);
    expect(result.name).toBe('record-sale');
    expect(result.tags).toEqual(['sale']);
  });
});

describe('extractSkillTitle', () => {
  it('returns frontmatter name when present', () => {
    const content = `---\nname: my-skill\n---\n# Heading`;
    expect(extractSkillTitle(content, 'my-skill.md')).toBe('my-skill');
  });

  it('falls back to first markdown heading when no frontmatter name', () => {
    const content = `---\ntags: [foo]\n---\n# My Heading`;
    expect(extractSkillTitle(content, 'my-skill.md')).toBe('My Heading');
  });

  it('falls back to filename without extension as last resort', () => {
    const content = `Plain text`;
    expect(extractSkillTitle(content, 'my-skill.md')).toBe('my-skill');
  });
});
