// Extract tags from markdown content
export function extractTags(content: string): string[] {
	const tagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
	const tags: string[] = [];
	let match;

	while ((match = tagRegex.exec(content)) !== null) {
		const tag = '#' + match[1];
		if (!tags.includes(tag)) {
			tags.push(tag);
		}
	}

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
		.replace(/(?:^|\s)#[a-zA-Z][a-zA-Z0-9_-]*/g, '') // Remove tags
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
