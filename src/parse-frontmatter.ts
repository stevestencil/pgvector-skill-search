import type { SkillMetadata } from './types.js';

/**
 * Parse YAML-like frontmatter from a skill markdown file.
 * Handles the --- delimited block at the top of the file.
 *
 * Supports both inline arrays (`tags: [a, b]`) and multi-line YAML arrays:
 * ```
 * tags:
 *   - a
 *   - b
 * ```
 */
export function parseSkillFrontmatter(content: string): SkillMetadata {
  const defaults: SkillMetadata = {
    name: '',
    tags: [],
    triggers: [],
    globalCandidate: false,
    createdBy: 'developer',
  };

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch?.[1]) {
    return defaults;
  }

  const frontmatter = frontmatterMatch[1];
  const metadata = { ...defaults };
  const lines = frontmatter.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();

    switch (key) {
      case 'name':
        metadata.name = rawValue;
        break;
      case 'tags':
      case 'triggers': {
        if (rawValue) {
          // Inline array: tags: [sale, revenue, deposit]
          metadata[key] = parseYamlInlineArray(rawValue);
        } else {
          // Multi-line array: tags:\n  - sale\n  - revenue
          const items: string[] = [];
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1] ?? '';
            if (!nextLine.startsWith('  - ')) break;
            i++;
            items.push(nextLine.slice(4).trim());
          }
          metadata[key] = items.filter(Boolean);
        }
        break;
      }
      case 'globalCandidate':
        metadata.globalCandidate = rawValue === 'true';
        break;
      case 'createdBy':
        if (rawValue === 'ai' || rawValue === 'user' || rawValue === 'developer') {
          metadata.createdBy = rawValue;
        }
        break;
    }
    i++;
  }

  return metadata;
}

/**
 * Parse a YAML inline array like "[sale, revenue, deposit]" into string[].
 */
function parseYamlInlineArray(value: string): string[] {
  const trimmed = value.replace(/^\[/, '').replace(/\]$/, '');
  if (!trimmed) return [];
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Extract a title from skill content.
 * Uses the frontmatter name field, or falls back to the first heading, or the filename.
 */
export function extractSkillTitle(content: string, filename: string): string {
  const metadata = parseSkillFrontmatter(content);
  if (metadata.name) return metadata.name;

  // Try first markdown heading
  const headingMatch = content.match(/^#+\s+(.+)$/m);
  if (headingMatch?.[1]) return headingMatch[1];

  return filename.replace(/\.md$/, '');
}
