import { ItemView, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type VisualDashboardPlugin from '../main';
import { VIEW_TYPE_VISUAL_DASHBOARD } from '../types';
import { extractTags, getPreviewText, stripMarkdown } from '../utils/markdown';
import { formatDate } from '../utils/date';

export class VisualDashboardView extends ItemView {
	private miniNotesGrid!: HTMLElement;
	private plugin: VisualDashboardPlugin;
	private draggedCard: HTMLElement | null = null;
	private currentFiles: TFile[] = [];
	private settingsChangedHandler: () => void;

	// Filter state
	private filterPinned: 'all' | 'pinned' | 'unpinned' = 'all';
	private filterTag: string | null = null;
	private allTags: string[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: VisualDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.settingsChangedHandler = () => {
			void this.onOpen();
		};
	}

	getViewType(): string {
		return VIEW_TYPE_VISUAL_DASHBOARD;
	}

	getDisplayText(): string {
		return this.plugin.data.viewTitle || 'Do Your Best Today!';
	}

	getIcon(): string {
		return 'dashboard-grid';
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass('visual-dashboard-container');

		// Create header - single row
		const header = this.contentEl.createDiv({ cls: 'dashboard-header' });

		// Title on left
		const title = header.createEl('h1', { text: this.plugin.data.viewTitle || 'Do Your Best Today!', cls: 'dashboard-title editable-title' });
		title.setAttribute('contenteditable', 'true');
		title.setAttribute('spellcheck', 'false');
		
		// Save title on blur
		title.addEventListener('blur', () => {
			const newTitle = title.textContent?.trim() || 'Do Your Best Today!';
			this.plugin.data.viewTitle = newTitle;
			void this.plugin.savePluginData();
		});
		
		// Save title on Enter key
		title.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				title.blur();
			}
		});
		
		// Reload on double-click
		title.addEventListener('dblclick', () => {
			void this.renderCards();
		});

		// Controls on right
		const controls = header.createDiv({ cls: 'header-controls' });

		// Tag filter - icon with dropdown
		const tagWrapper = controls.createDiv({ cls: 'tag-filter-wrapper' });
		const tagIcon = tagWrapper.createDiv({ cls: 'filter-icon tag-filter-button' });
		setIcon(tagIcon, 'tag');

		// Create dropdown menu
		const dropdown = tagWrapper.createDiv({ cls: 'tag-dropdown-menu' });
		
		// Add "All tags" option
		const allOption = dropdown.createDiv({ cls: 'tag-dropdown-item' });
		allOption.textContent = 'All tags';
		allOption.addEventListener('click', () => {
			this.filterTag = null;
			tagIcon.toggleClass('active', false);
			dropdown.toggleClass('show', false);
			void this.renderCards();
		});

		// Toggle dropdown on click
		tagIcon.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			const isCurrentlyShown = dropdown.hasClass('show');
			dropdown.toggleClass('show', !isCurrentlyShown);
			if (!isCurrentlyShown) {
				void this.populateTagDropdown(dropdown, tagIcon);
			}
		});

		// Close dropdown when clicking outside
		this.registerDomEvent(document, 'click', () => {
			dropdown.toggleClass('show', false);
		});

		// Pin toggle icon
		const pinToggle = controls.createDiv({ cls: 'filter-icon' });
		setIcon(pinToggle, 'pin');
		pinToggle.setAttribute('aria-label', 'Show pinned only');
		pinToggle.addEventListener('click', () => {
			if (this.filterPinned === 'all') {
				this.filterPinned = 'pinned';
				pinToggle.addClass('active');
			} else {
				this.filterPinned = 'all';
				pinToggle.removeClass('active');
			}
			void this.renderCards();
		});

		// Create mini notes grid container
		this.miniNotesGrid = this.contentEl.createDiv({ cls: 'mini-notes-grid' });

		// Render the cards
		await this.renderCards();

		// Listen for settings changes using custom event
		window.addEventListener('mini-notes:settings-changed', this.settingsChangedHandler);

		// Listen for file changes to auto-refresh
		this.registerEvent(
			this.app.vault.on('modify', () => this.debouncedRefresh())
		);
		this.registerEvent(
			this.app.vault.on('create', () => this.debouncedRefresh())
		);
		this.registerEvent(
			this.app.vault.on('delete', () => this.debouncedRefresh())
		);
	}

	private async populateTagDropdown(dropdown: HTMLElement, tagIcon: HTMLElement) {
		if (this.allTags.length > 0) {
			// Tags already loaded, just render them
			this.renderTagDropdownItems(dropdown, tagIcon);
			return;
		}

		try {
			const files = this.app.vault.getMarkdownFiles().slice(0, this.plugin.data.maxNotes * 3);
			const tagSet = new Set<string>();

			for (const file of files) {
				try {
					const content = await this.app.vault.cachedRead(file);
					const tags = extractTags(content);
					tags.forEach(tag => tagSet.add(tag));
				} catch {
					// Skip files that can't be read
					console.warn(`Could not read file for tags: ${file.path}`);
				}
			}

			this.allTags = Array.from(tagSet).sort();
			this.renderTagDropdownItems(dropdown, tagIcon);
		} catch (error) {
			console.error('Error populating tag dropdown:', error);
		}
	}

	private renderTagDropdownItems(dropdown: HTMLElement, tagIcon: HTMLElement) {
		// Remove existing tag items (keep "All tags" option)
		const existingTags = dropdown.querySelectorAll('.tag-dropdown-item:not(:first-child)');
		existingTags.forEach(el => el.remove());

		this.allTags.forEach(tag => {
			const item = dropdown.createDiv({ cls: 'tag-dropdown-item tag-pill' });
			item.textContent = tag;
			item.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this.filterTag = tag;
				tagIcon.toggleClass('active', true);
				dropdown.toggleClass('show', false);
				void this.renderCards();
			});
		});
	}

	private debouncedRefresh() {
		// Use registerInterval for proper cleanup
		this.registerInterval(
			window.setTimeout(() => {
				void this.renderCards();
			}, 1000)
		);
	}

	async renderCards() {
		try {
			this.miniNotesGrid.empty();

			// Get all markdown files, filtered by source folder if specified
			let files = this.app.vault.getMarkdownFiles();
		
			// Filter by source folder if specified ("/" = all notes)
			const sourceFolder = this.plugin.data.sourceFolder.trim();
			if (sourceFolder && sourceFolder !== '/') {
				files = files.filter((file: TFile) => file.path.startsWith(sourceFolder));
			}
			
			files = files
				.sort((a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime)
				.slice(0, this.plugin.data.maxNotes * 3); // Get more initially for filtering

			// Pre-load content for tag filtering
			const fileContents = new Map<string, string>();
			for (const file of files) {
				fileContents.set(file.path, await this.app.vault.cachedRead(file));
			}

		// Apply pinned filter
		if (this.filterPinned === 'pinned') {
			files = files.filter((f: TFile) => this.plugin.isPinned(f.path));
		} else if (this.filterPinned === 'unpinned') {
			files = files.filter((f: TFile) => !this.plugin.isPinned(f.path));
		}

		// Apply tag filter
		if (this.filterTag) {
			files = files.filter((f: TFile) => {
				const content = fileContents.get(f.path) || '';
				const tags = extractTags(content);
				return tags.includes(this.filterTag!);
			});
		}

		// Limit after filtering
		files = files.slice(0, this.plugin.data.maxNotes);

		// Separate pinned and unpinned notes
		const pinnedFiles: TFile[] = [];
		const unpinnedFiles: TFile[] = [];

		files.forEach((file: TFile) => {
			if (this.plugin.isPinned(file.path)) {
				pinnedFiles.push(file);
			} else {
				unpinnedFiles.push(file);
			}
		});

		// Sort pinned files by custom order, then by modification time
		pinnedFiles.sort((a, b) => {
			const aOrder = this.plugin.getOrderIndex(a.path);
			const bOrder = this.plugin.getOrderIndex(b.path);

			if (aOrder > -1 && bOrder > -1) {
				return aOrder - bOrder;
			}

			if (aOrder > -1 && bOrder === -1) return -1;
			if (aOrder === -1 && bOrder > -1) return 1;

			return b.stat.mtime - a.stat.mtime;
		});

		// Sort unpinned files by custom order, then by modification time
		unpinnedFiles.sort((a, b) => {
			const aOrder = this.plugin.getOrderIndex(a.path);
			const bOrder = this.plugin.getOrderIndex(b.path);

			if (aOrder > -1 && bOrder > -1) {
				return aOrder - bOrder;
			}

			if (aOrder > -1 && bOrder === -1) return -1;
			if (aOrder === -1 && bOrder > -1) return 1;

			return b.stat.mtime - a.stat.mtime;
		});

		// Store the combined order for drag-and-drop
		this.currentFiles = [...pinnedFiles, ...unpinnedFiles];

		if (files.length === 0) {
			const emptyState = this.miniNotesGrid.createDiv({ cls: 'dashboard-empty-state' });
			emptyState.createEl('h3', { text: 'No matching notes' });
			emptyState.createEl('p', { text: 'Try adjusting your filters' });
			return;
		}

		let globalIndex = 0;

		// Check if we need sections (both pinned and unpinned exist)
		const needsSections = pinnedFiles.length > 0 && unpinnedFiles.length > 0;

		if (needsSections) {
			// Render pinned section
			if (pinnedFiles.length > 0) {
				const pinnedGrid = this.miniNotesGrid.createDiv({ cls: 'mini-notes-grid-section' });
				for (const file of pinnedFiles) {
					const card = await this.createCard(file, globalIndex++);
					pinnedGrid.appendChild(card);
				}
			}

			// Separator line between sections
			this.miniNotesGrid.createDiv({ cls: 'section-separator' });

			// Render all notes section
			if (unpinnedFiles.length > 0) {
				const notesGrid = this.miniNotesGrid.createDiv({ cls: 'mini-notes-grid-section' });
				for (const file of unpinnedFiles) {
					const card = await this.createCard(file, globalIndex++);
					notesGrid.appendChild(card);
				}
			}
		} else {
			// Single section without header
			const singleGrid = this.miniNotesGrid.createDiv({ cls: 'mini-notes-grid-section' });
			for (const file of [...pinnedFiles, ...unpinnedFiles]) {
				const card = await this.createCard(file, globalIndex++);
				singleGrid.appendChild(card);
			}
		}
		} catch (error) {
			console.error('Error rendering cards:', error);
			const errorMsg = this.miniNotesGrid.createDiv({ cls: 'dashboard-error' });
			errorMsg.createEl('p', { text: 'Failed to render cards. Check console for details.' });
		}
	}

	async createCard(file: TFile, index: number): Promise<HTMLElement> {
		const card = document.createElement('div');
		card.addClass('dashboard-card');
		card.setAttribute('data-path', file.path);
		card.setAttribute('data-index', index.toString());
		card.setAttribute('draggable', 'true');

		try {
			// Get content and preview
			const content = await this.app.vault.cachedRead(file);
		const cleanContent = stripMarkdown(content);
		const previewLength = Math.min(cleanContent.length, 300);
		const previewText = getPreviewText(content, previewLength);

		// Dynamic sizing based on content length - more granular
		const contentLen = cleanContent.length;
		if (contentLen > 1500) {
			card.addClass('card-xl');
		} else if (contentLen > 800) {
			card.addClass('card-large');
		} else if (contentLen > 400) {
			card.addClass('card-medium');
		} else if (contentLen > 150) {
			card.addClass('card-small');
		} else {
			card.addClass('card-xs');
		}

		// Check if pinned
		const isPinned = this.plugin.isPinned(file.path);
		if (isPinned) {
			card.addClass('card-pinned');
		}

		// Apply saved color if exists
		const savedColor = this.plugin.data.noteColors[file.path];
		if (savedColor) {
			card.style.backgroundColor = savedColor;
		}

		// Pin button (shows on hover)
		const pinBtn = card.createDiv({ cls: 'card-pin-btn' + (isPinned ? ' pinned' : '') });
		setIcon(pinBtn, 'pin');
		pinBtn.setAttribute('aria-label', isPinned ? 'Unpin note' : 'Pin note');
		pinBtn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			void this.plugin.togglePin(file.path).then(async (nowPinned) => {
				pinBtn.classList.toggle('pinned', nowPinned);
				card.classList.toggle('card-pinned', nowPinned);
				await this.renderCards();
			});
		});

		// Color button (shows on hover) next to pin
		const colorBtn = card.createDiv({ cls: 'card-color-btn' });
		setIcon(colorBtn, 'palette');
		colorBtn.setAttribute('aria-label', 'Change note color');
		
		// Create color palette dropdown
		const pastelColors = [
			'#FFE5E5', // Light pink
			'#FFE5CC', // Light peach
			'#FFF4CC', // Light yellow
			'#E5F5E5', // Light green
			'#E5F2FF', // Light blue
			'#F0E5FF', // Light purple
			'#FFE5F5', // Light magenta
			'#E5E5E5'  // Light gray (remove color)
		];
		
		const colorDropdown = card.createDiv({ cls: 'card-color-dropdown' });
		
		pastelColors.forEach((color, index) => {
			const colorCircle = colorDropdown.createDiv({ cls: 'color-circle' });
			colorCircle.style.backgroundColor = color;
			
			// Last color is for removing
			if (index === pastelColors.length - 1) {
				colorCircle.addClass('color-circle-clear');
				colorCircle.setAttribute('aria-label', 'Remove color');
			} else {
				colorCircle.setAttribute('aria-label', 'Apply color');
			}
			
			colorCircle.addEventListener('click', async (e: MouseEvent) => {
				e.stopPropagation();
				
				if (index === pastelColors.length - 1) {
					// Remove color
					card.style.backgroundColor = '';
					delete this.plugin.data.noteColors[file.path];
				} else {
					// Apply color
					card.style.backgroundColor = color;
					this.plugin.data.noteColors[file.path] = color;
				}
				
				await this.plugin.savePluginData();
				colorDropdown.removeClass('show');
			});
		});
		
		// Toggle dropdown on click
		colorBtn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			colorDropdown.toggleClass('show', !colorDropdown.hasClass('show'));
		});
		
		// Close dropdown when clicking outside
		card.addEventListener('click', () => {
			colorDropdown.removeClass('show');
		});

		// Card header with file info
		const cardHeader = card.createDiv({ cls: 'card-header' });

		// Title
		const title = cardHeader.createEl('h3', {
			text: file.basename,
			cls: 'card-title'
		});
		title.setAttribute('title', file.basename);

		// Card content (preview)
		const cardContent = card.createDiv({ cls: 'card-content' });
		if (previewText.trim()) {
			cardContent.createEl('p', {
				text: previewText,
				cls: 'card-preview'
			});
		} else {
			cardContent.createEl('p', {
				text: 'Empty note...',
				cls: 'card-preview card-preview-empty'
			});
		}

		// Card footer with metadata
		const cardFooter = card.createDiv({ cls: 'card-footer' });

		// Tags on left
		const tagsContainer = cardFooter.createDiv({ cls: 'card-tags' });
		const tags = extractTags(content);
		if (tags.length > 0) {
			tags.slice(0, 3).forEach(tag => {
				tagsContainer.createSpan({ cls: 'card-tag', text: tag });
			});
			if (tags.length > 3) {
				tagsContainer.createSpan({ cls: 'card-tag-more', text: `+${tags.length - 3}` });
			}
		}
		
		// Date on right
		const dateSpan = cardFooter.createSpan({ cls: 'card-date' });
		dateSpan.createSpan({ text: formatDate(file.stat.mtime) });

		// Click handler to open the note
		card.addEventListener('click', (e: MouseEvent) => {
			// Don't open if clicking pin button or during drag
			if ((e.target as HTMLElement).closest('.card-pin-btn')) return;
			const leaf = this.app.workspace.getLeaf('tab');
			void leaf.openFile(file);
		});

		// Drag and drop handlers
		card.addEventListener('dragstart', (e: DragEvent) => this.handleDragStart(e, card));
		card.addEventListener('dragend', (e: DragEvent) => this.handleDragEnd(e, card));
		card.addEventListener('dragover', (e: DragEvent) => this.handleDragOver(e, card));
		card.addEventListener('dragenter', (e: DragEvent) => this.handleDragEnter(e, card));
		card.addEventListener('dragleave', (e: DragEvent) => this.handleDragLeave(e, card));
		card.addEventListener('drop', (e: DragEvent) => void this.handleDrop(e, card));
		} catch (error) {
			console.error(`Error creating card for ${file.path}:`, error);
			// Create fallback card with error message
			const errorContent = card.createDiv({ cls: 'card-error' });
			errorContent.createEl('p', { text: 'Error loading note' });
		}

		return card;
	}

	// Drag and Drop Handlers
	handleDragStart(e: DragEvent, card: HTMLElement) {
		this.draggedCard = card;
		card.classList.add('dragging');

		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', card.getAttribute('data-path') || '');
		}
	}

	handleDragEnd(e: DragEvent, card: HTMLElement) {
		card.classList.remove('dragging');
		this.draggedCard = null;

		// Remove all drag-over classes
		this.miniNotesGrid.querySelectorAll('.drag-over').forEach(el => {
			el.classList.remove('drag-over');
		});
	}

	handleDragOver(e: DragEvent, card: HTMLElement) {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
	}

	handleDragEnter(e: DragEvent, card: HTMLElement) {
		e.preventDefault();
		if (card !== this.draggedCard) {
			card.classList.add('drag-over');
		}
	}

	handleDragLeave(e: DragEvent, card: HTMLElement) {
		card.classList.remove('drag-over');
	}

	async handleDrop(e: DragEvent, targetCard: HTMLElement) {
		e.preventDefault();
		targetCard.classList.remove('drag-over');

		if (!this.draggedCard || this.draggedCard === targetCard) return;

		const draggedPath = this.draggedCard.getAttribute('data-path');
		const targetPath = targetCard.getAttribute('data-path');

		if (!draggedPath || !targetPath) return;

		// Get current order
		const currentOrder = this.currentFiles.map(f => f.path);

		// Find indices
		const draggedIndex = currentOrder.indexOf(draggedPath);
		const targetIndex = currentOrder.indexOf(targetPath);

		if (draggedIndex === -1 || targetIndex === -1) return;

		// Reorder
		currentOrder.splice(draggedIndex, 1);
		currentOrder.splice(targetIndex, 0, draggedPath);

		// Save new order and re-render
		void this.plugin.updateOrder(currentOrder).then(() => this.renderCards());
	}

	async onClose() {
		// Remove custom event listener
		window.removeEventListener('mini-notes:settings-changed', this.settingsChangedHandler);
		// Clean up is handled automatically by registerInterval
		this.contentEl.empty();
	}
}
