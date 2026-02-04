const TAG_SEGMENT_PATTERN = '[0-9A-Za-z_-]+(?:\/[0-9A-Za-z_-]+)*';

// Extract tags from YAML frontmatter
function extractFrontmatterTags(content: string): string[] {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!frontmatterMatch || !frontmatterMatch[1]) return [];

	const frontmatter = frontmatterMatch[1];
	const tags: string[] = [];

	// Match "tags:" followed by array syntax [tag1, tag2] or list syntax
	const tagsLineMatch = frontmatter.match(/^tags:\s*(.*)$/m);
	if (tagsLineMatch && tagsLineMatch[1]) {
		const tagsValue = tagsLineMatch[1].trim();

		// Array syntax: tags: [tag1, tag2, "tag3"]
		if (tagsValue.startsWith('[')) {
			const arrayMatch = tagsValue.match(/\[(.*)\]/);
			if (arrayMatch && arrayMatch[1]) {
				const items = arrayMatch[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, ''));
				items.forEach(tag => {
					if (tag) tags.push('#' + tag);
				});
			}
		} else if (tagsValue) {
			// Single tag on same line: tags: mytag
			tags.push('#' + tagsValue.replace(/^["']|["']$/g, ''));
		}
	}

	// Match list syntax:
	// tags:
	//   - tag1
	//   - tag2
	const listMatch = frontmatter.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
	if (listMatch && listMatch[1]) {
		const listItems = listMatch[1].match(/^\s+-\s+(.+)$/gm);
		if (listItems) {
			listItems.forEach(item => {
				const tag = item.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, '');
				if (tag && !tags.includes('#' + tag)) {
					tags.push('#' + tag);
				}
			});
		}
	}

	return tags;
}

// Extract tags from markdown content, including hierarchical tags like #parent/child
// Also extracts tags from YAML frontmatter
export function extractTags(content: string): string[] {
	const tagRegex = new RegExp(`(?:^|\\s)#(${TAG_SEGMENT_PATTERN})`, 'g');
	const tags: string[] = [];
	let match;

	// Extract inline tags
	while ((match = tagRegex.exec(content)) !== null) {
		const tag = '#' + match[1];
		if (!tags.includes(tag)) {
			tags.push(tag);
		}
	}

	// Extract frontmatter tags
	const frontmatterTags = extractFrontmatterTags(content);
	frontmatterTags.forEach(tag => {
		if (!tags.includes(tag)) {
			tags.push(tag);
		}
	});

	return tags;
}

// Strip markdown formatting from content
export function stripMarkdown(content: string): string {
	return content
		.replace(/^---[\s\S]*?---\n?/, '') // YAML frontmatter
		.replace(/^#+\s+/gm, '') // Headers
		.replace(/\*\*(.+?)\*\*/g, '$1') // Bold
		.replace(/\*(.+?)\*/g, '$1') // Italic
		.replace(/__(.+?)__/g, '$1') // Bold alt
		.replace(/_(.+?)_/g, '$1') // Italic alt
		.replace(/~~(.+?)~~/g, '$1') // Strikethrough
		.replace(/`{1,3}[^`]*`{1,3}/g, '') // Code
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // Images
		.replace(/^>\s+/gm, '') // Blockquotes
		.replace(/^[-*+]\s+/gm, '') // List items
		.replace(/^\d+\.\s+/gm, '') // Numbered lists
		.replace(new RegExp(`(?:^|\\s)#${TAG_SEGMENT_PATTERN}`, 'g'), '') // Remove tags
		.trim();
}

// Get preview text from content, stripped of markdown and truncated
export function getPreviewText(content: string, maxLength: number): string {
	let text = stripMarkdown(content);
	text = text.replace(/\n{2,}/g, '\n').trim();

	if (text.length > maxLength) {
		text = text.substring(0, maxLength).trim() + '...';
	}

	return text;
}
