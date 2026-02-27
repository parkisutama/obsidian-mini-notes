import { ItemView, TFile, WorkspaceLeaf, setIcon, MarkdownRenderer, Platform } from 'obsidian';
import type VisualDashboardPlugin from '../main';
import { VIEW_TYPE_VISUAL_DASHBOARD } from '../types';
import { extractTags, getPreviewText, getMarkdownForPreview, stripMarkdown, formatTagForDisplay, tagMatchesFilter, isFileInFolderOrSubfolder } from '../utils/markdown';
import { formatDate } from '../utils/date';
import { FILE_FETCH_MULTIPLIER, DEBOUNCE_REFRESH_MS, MAX_PREVIEW_LENGTH, CARD_SIZE, MAX_CARD_HEIGHT } from '../constants';
import { QuickNoteBar } from './quick-note-bar';

export class VisualDashboardView extends ItemView {
	private miniNotesGrid!: HTMLElement;
	private plugin: VisualDashboardPlugin;
	private draggedCard: HTMLElement | null = null;
	private currentFiles: TFile[] = [];
	private settingsChangedHandler: () => void;
	private refreshTimeoutId: number | null = null;
	private eventsRegistered = false;
	private quickNoteBar: QuickNoteBar | null = null;

	// Smooth drag and drop state
	private dragOverTargetCard: HTMLElement | null = null;
	private pendingDragTargetCard: HTMLElement | null = null;
	private pendingDragClientY: number | null = null;
	private dragFrameId: number | null = null;

	// Filter state
	private filterPinned: 'all' | 'pinned' | 'unpinned' = 'all';
	private filterTag: string | null = null;
	private filterFolder: string | null = null;
	private filterColor: string | null = null;
	private filterType: string | null = null;
	private allTags: string[] = [];
	private allFolders: string[] = [];
	private tagDropdown: HTMLElement | null = null;
	private tagIcon: HTMLElement | null = null;
	private folderDropdown: HTMLElement | null = null;
	private folderIcon: HTMLElement | null = null;
	private colorDropdown: HTMLElement | null = null;
	private colorIcon: HTMLElement | null = null;
	private typeDropdown: HTMLElement | null = null;
	private typeIcon: HTMLElement | null = null;
	private searchQuery: string = '';

	// Card color dropdown state
	private activeCardColorDropdown: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: VisualDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.settingsChangedHandler = () => {
			void this.refreshView();
		};
	}

	getViewType(): string {
		return VIEW_TYPE_VISUAL_DASHBOARD;
	}

	getDisplayText(): string {
		return 'Mini notes';
	}

	getIcon(): string {
		return 'dashboard-grid';
	}

	async onOpen() {
		const container = this.contentEl;
		container.empty();
		container.addClass('visual-dashboard-container');

		// Add mobile class if on mobile
		if (Platform.isMobile) {
			container.addClass('mobile');
		}

		// Apply theme color
		this.applyThemeColor();

		// Create sticky header wrapper
		const stickyWrapper = this.contentEl.createDiv({ cls: 'dashboard-sticky-header' });

		// Create header - single row
		const header = stickyWrapper.createDiv({ cls: 'dashboard-header' });

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

		// Controls on right (search, tag filter, pin filter)
		const controls = header.createDiv({ cls: 'header-controls' });

		// Search bar in header
		const searchInput = controls.createEl('input', {
			cls: 'dashboard-search-input',
			attr: {
				placeholder: 'Search notes...',
				type: 'text'
			}
		});

		searchInput.addEventListener('input', (e) => {
			this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
			void this.renderCards();
		});

		// Folder filter - icon with dropdown
		const folderWrapper = controls.createDiv({ cls: 'filter-wrapper' });
		this.folderIcon = folderWrapper.createDiv({ cls: 'filter-icon folder-filter-button' });
		setIcon(this.folderIcon, 'folder');
		this.folderIcon.setAttribute('aria-label', 'Filter by folder');

		// Create folder dropdown menu
		this.folderDropdown = folderWrapper.createDiv({ cls: 'filter-dropdown-menu' });

		// Add "All folders" option
		const allFolderOption = this.folderDropdown.createDiv({ cls: 'filter-dropdown-item' });
		allFolderOption.textContent = 'All folders';
		allFolderOption.addEventListener('click', () => {
			this.filterFolder = null;
			this.folderIcon!.toggleClass('active', false);
			this.folderDropdown!.toggleClass('show', false);
			void this.renderCards();
		});

		// Toggle folder dropdown on click
		this.folderIcon.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			// Close other dropdowns
			this.tagDropdown?.toggleClass('show', false);
			this.colorDropdown?.toggleClass('show', false);
			this.typeDropdown?.toggleClass('show', false);
			const isCurrentlyShown = this.folderDropdown!.hasClass('show');
			this.folderDropdown!.toggleClass('show', !isCurrentlyShown);
			if (!isCurrentlyShown) {
				this.populateFolderDropdown();
			}
		});

		// Tag filter - icon with dropdown
		const tagWrapper = controls.createDiv({ cls: 'filter-wrapper' });
		this.tagIcon = tagWrapper.createDiv({ cls: 'filter-icon tag-filter-button' });
		setIcon(this.tagIcon, 'tag');
		this.tagIcon.setAttribute('aria-label', 'Filter by tag');

		// Create dropdown menu
		this.tagDropdown = tagWrapper.createDiv({ cls: 'filter-dropdown-menu' });

		// Add "All tags" option
		const allOption = this.tagDropdown.createDiv({ cls: 'filter-dropdown-item' });
		allOption.textContent = 'All tags';
		allOption.addEventListener('click', () => {
			this.filterTag = null;
			this.tagIcon!.toggleClass('active', false);
			this.tagDropdown!.toggleClass('show', false);
			void this.renderCards();
		});

		// Toggle dropdown on click
		this.tagIcon.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			// Close other dropdowns
			this.folderDropdown?.toggleClass('show', false);
			this.colorDropdown?.toggleClass('show', false);
			this.typeDropdown?.toggleClass('show', false);
			const isCurrentlyShown = this.tagDropdown!.hasClass('show');
			this.tagDropdown!.toggleClass('show', !isCurrentlyShown);
			if (!isCurrentlyShown) {
				this.populateTagDropdown();
			}
		});

		// Color filter - icon with dropdown
		const colorWrapper = controls.createDiv({ cls: 'filter-wrapper' });
		this.colorIcon = colorWrapper.createDiv({ cls: 'filter-icon color-filter-button' });
		setIcon(this.colorIcon, 'palette');
		this.colorIcon.setAttribute('aria-label', 'Filter by color');

		// Create color dropdown menu
		this.colorDropdown = colorWrapper.createDiv({ cls: 'filter-dropdown-menu color-dropdown' });

		// Add "All colors" option
		const allColorOption = this.colorDropdown.createDiv({ cls: 'filter-dropdown-item' });
		allColorOption.textContent = 'All colors';
		allColorOption.addEventListener('click', () => {
			this.filterColor = null;
			this.colorIcon!.toggleClass('active', false);
			this.colorDropdown!.toggleClass('show', false);
			void this.renderCards();
		});

		// Add "No color" option
		const noColorOption = this.colorDropdown.createDiv({ cls: 'filter-dropdown-item' });
		noColorOption.textContent = 'No color';
		noColorOption.addEventListener('click', () => {
			this.filterColor = 'none';
			this.colorIcon!.toggleClass('active', true);
			this.colorDropdown!.toggleClass('show', false);
			void this.renderCards();
		});

		// Add color options
		const colorOptions = [
			{ name: 'Pink', color: 'var(--pastel-pink)' },
			{ name: 'Peach', color: 'var(--pastel-peach)' },
			{ name: 'Yellow', color: 'var(--pastel-yellow)' },
			{ name: 'Green', color: 'var(--pastel-green)' },
			{ name: 'Blue', color: 'var(--pastel-blue)' },
			{ name: 'Purple', color: 'var(--pastel-purple)' },
			{ name: 'Magenta', color: 'var(--pastel-magenta)' }
		];

		colorOptions.forEach(({ name, color }) => {
			const item = this.colorDropdown!.createDiv({ cls: 'filter-dropdown-item color-item' });
			const colorCircle = item.createDiv({ cls: 'color-filter-circle' });
			colorCircle.style.backgroundColor = color;
			item.createSpan({ text: name });
			item.addEventListener('click', () => {
				this.filterColor = color;
				this.colorIcon!.toggleClass('active', true);
				this.colorDropdown!.toggleClass('show', false);
				void this.renderCards();
			});
		});

		// Toggle color dropdown on click
		this.colorIcon.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			// Close other dropdowns
			this.folderDropdown?.toggleClass('show', false);
			this.tagDropdown?.toggleClass('show', false);
			this.typeDropdown?.toggleClass('show', false);
			this.colorDropdown!.toggleClass('show', !this.colorDropdown!.hasClass('show'));
		});

		// Type filter - icon with dropdown
		const typeWrapper = controls.createDiv({ cls: 'filter-wrapper' });
		this.typeIcon = typeWrapper.createDiv({ cls: 'filter-icon type-filter-button' });
		setIcon(this.typeIcon, 'file-type');
		this.typeIcon.setAttribute('aria-label', 'Filter by type');

		// Create type dropdown menu
		this.typeDropdown = typeWrapper.createDiv({ cls: 'filter-dropdown-menu' });

		// Add "All types" option
		const allTypeOption = this.typeDropdown.createDiv({ cls: 'filter-dropdown-item' });
		allTypeOption.textContent = 'All types';
		allTypeOption.addEventListener('click', () => {
			this.filterType = null;
			this.typeIcon!.toggleClass('active', false);
			this.typeDropdown!.toggleClass('show', false);
			void this.renderCards();
		});

		// Type options will be populated dynamically
		this.typeIcon.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			// Close other dropdowns
			this.folderDropdown?.toggleClass('show', false);
			this.tagDropdown?.toggleClass('show', false);
			this.colorDropdown?.toggleClass('show', false);
			const isCurrentlyShown = this.typeDropdown!.hasClass('show');
			this.typeDropdown!.toggleClass('show', !isCurrentlyShown);
			if (!isCurrentlyShown) {
				this.populateTypeDropdown();
			}
		});

		// Close all dropdowns when clicking outside
		this.registerDomEvent(document, 'click', () => {
			this.tagDropdown!.toggleClass('show', false);
			this.folderDropdown?.toggleClass('show', false);
			this.colorDropdown?.toggleClass('show', false);
			this.typeDropdown?.toggleClass('show', false);
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

		// Add quick note bar at the bottom for both desktop and mobile
		// Mobile version will be styled differently with CSS
		this.quickNoteBar = new QuickNoteBar(this.plugin);
		const quickNoteContainer = this.contentEl.createDiv({ cls: 'quick-note-container' });
		if (Platform.isMobile) {
			quickNoteContainer.addClass('mobile');
		}
		quickNoteContainer.appendChild(this.quickNoteBar.getElement());
		this.quickNoteBar.render();

		// Render the cards
		await this.renderCards();

		// Register event listeners only once
		if (!this.eventsRegistered) {
			this.setupEventListeners();
			this.eventsRegistered = true;
		}
	}

	private setupEventListeners() {
		// Listen for settings changes using workspace event
		this.registerEvent(
			// @ts-ignore - Custom event type
			this.app.workspace.on('mini-notes:settings-changed', this.settingsChangedHandler)
		);

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

		// Close card color dropdowns when clicking outside
		this.registerDomEvent(document, 'click', () => {
			this.closeAllCardColorDropdowns();
		});
	}

	private async refreshView() {
		// Update theme color
		this.applyThemeColor();

		// Update view title
		const titleElement = this.contentEl.querySelector('.dashboard-title') as HTMLElement;
		if (titleElement) {
			titleElement.textContent = this.plugin.data.viewTitle || 'Do Your Best Today!';
		}

		// Re-render cards to reflect setting changes
		await this.renderCards();
	}

	private populateTagDropdown() {
		this.renderTagDropdownItems();
	}

	private populateFolderDropdown() {
		if (!this.folderDropdown || !this.folderIcon) return;

		// Remove existing folder items (keep "All folders" option)
		const existingFolders = this.folderDropdown.querySelectorAll('.filter-dropdown-item:not(:first-child)');
		existingFolders.forEach(el => el.remove());

		this.allFolders.forEach(folder => {
			const item = this.folderDropdown!.createDiv({ cls: 'filter-dropdown-item folder-item' });
			item.textContent = folder;
			item.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this.filterFolder = folder;
				this.folderIcon!.toggleClass('active', true);
				this.folderDropdown!.toggleClass('show', false);
				void this.renderCards();
			});
		});
	}

	private populateTypeDropdown() {
		if (!this.typeDropdown || !this.typeIcon) return;

		// Remove existing type items (keep "All types" option)
		const existingTypes = this.typeDropdown.querySelectorAll('.filter-dropdown-item:not(:first-child)');
		existingTypes.forEach(el => el.remove());

		// Get unique extensions from allowed extensions
		const allowedExts = this.plugin.data.allowedExtensions.length > 0
			? this.plugin.data.allowedExtensions
			: ['md'];

		allowedExts.forEach(ext => {
			const item = this.typeDropdown!.createDiv({ cls: 'filter-dropdown-item type-item' });
			item.textContent = `.${ext}`;
			item.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this.filterType = ext;
				this.typeIcon!.toggleClass('active', true);
				this.typeDropdown!.toggleClass('show', false);
				void this.renderCards();
			});
		});
	}

	private renderTagDropdownItems() {
		if (!this.tagDropdown || !this.tagIcon) return;

		// Remove existing tag items (keep "All tags" option)
		const existingTags = this.tagDropdown.querySelectorAll('.filter-dropdown-item:not(:first-child)');
		existingTags.forEach(el => el.remove());

		this.allTags.forEach(tag => {
			const item = this.tagDropdown!.createDiv({ cls: 'filter-dropdown-item tag-pill' });
			item.textContent = formatTagForDisplay(tag);
			item.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this.filterTag = tag;
				this.tagIcon!.toggleClass('active', true);
				this.tagDropdown!.toggleClass('show', false);
				void this.renderCards();
			});
		});
	}

	private debouncedRefresh() {
		if (this.refreshTimeoutId !== null) {
			window.clearTimeout(this.refreshTimeoutId);
		}

		this.refreshTimeoutId = window.setTimeout(() => {
			void this.renderCards();
			this.refreshTimeoutId = null;
		}, DEBOUNCE_REFRESH_MS);
	}

	private applyThemeColor() {
		const container = this.contentEl;
		let themeColor: string;

		switch (this.plugin.data.themeColor) {
			case 'black':
				themeColor = '#000000';
				break;
			case 'custom':
				themeColor = this.plugin.data.customThemeColor;
				break;
			case 'obsidian':
			default:
				// Use Obsidian's interactive accent color
				themeColor = getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim();
				break;
		}

		// Set CSS custom property for theme color
		container.style.setProperty('--masonry-theme-color', themeColor);
	}

	async renderCards() {
		try {
			this.miniNotesGrid.empty();

			// Get all files matching allowed extensions
			const allowedExts = this.plugin.data.allowedExtensions.length > 0
				? this.plugin.data.allowedExtensions
				: ['md']; // Default to .md if no extensions configured

			let files = this.app.vault.getFiles().filter((file: TFile) => {
				const ext = file.extension.toLowerCase();
				return allowedExts.includes(ext);
			});

			// Filter out Excalidraw files (they have .md extension but are not regular markdown)
			files = files.filter((file: TFile) => {
				const path = file.path.toLowerCase();
				// Check for .excalidraw extension or .excalidraw.md pattern
				return !path.endsWith('.excalidraw.md') && !path.endsWith('.excalidraw');
			});

			// Filter by source folder if specified ("/" = all notes)
			const sourceFolder = this.plugin.data.sourceFolder.trim().replace(/\/+$/, '');
			if (sourceFolder && sourceFolder !== '/') {
				files = files.filter((file: TFile) => file.path.startsWith(sourceFolder + '/'));
			}

			// Filter out config folder files to avoid reading plugin/config files
			files = files.filter((file: TFile) => !file.path.startsWith(this.app.vault.configDir + '/'));

			// Filter out excluded folders
			if (this.plugin.data.excludedFolders.length > 0) {
				files = files.filter((file: TFile) => {
					return !this.plugin.data.excludedFolders.some(excludedFolder => {
						const normalized = excludedFolder.trim().replace(/\/+$/, '');
						return file.path.startsWith(normalized + '/');
					});
				});
			}

			// Collect tags from ALL files (before slicing) to show complete tag list
			const tagSet = new Set<string>();
			const folderSet = new Set<string>();
			for (const file of files) {
				try {
					const content = await this.app.vault.cachedRead(file);
					const tags = extractTags(content);
					tags.forEach(tag => tagSet.add(tag));
					// Collect folder paths
					const folder = file.parent?.path;
					if (folder) {
						folderSet.add(folder);
					}
				} catch (error) {
					console.warn(`Failed to read file ${file.path} for tags:`, error);
				}
			}
			this.allTags = Array.from(tagSet).sort();
			this.allFolders = Array.from(folderSet).sort();

			// Update tag dropdown with new tags
			this.renderTagDropdownItems();

			// Now sort and limit files for display
			files = files
				.sort((a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime)
				.slice(0, this.plugin.data.maxNotes * FILE_FETCH_MULTIPLIER); // Get more initially for filtering

			// Pre-load content for filtering (only for the limited set we'll display)
			const fileContents = new Map<string, string>();
			for (const file of files) {
				try {
					const content = await this.app.vault.cachedRead(file);
					fileContents.set(file.path, content);
				} catch (error) {
					console.warn(`Failed to read file ${file.path}:`, error);
					fileContents.set(file.path, '');
				}
			}

			// Filter out Excalidraw files by content (catches files not following .excalidraw.md naming)
			files = files.filter((f: TFile) => {
				const content = fileContents.get(f.path) || '';
				// Check for excalidraw-plugin in frontmatter or Excalidraw JSON markers
				return !content.includes('excalidraw-plugin:') && !content.includes('# Excalidraw Data');
			});

			// Apply search filter
			if (this.searchQuery) {
				files = files.filter((f: TFile) => {
					const content = fileContents.get(f.path) || '';
					const searchableText = `${f.basename} ${stripMarkdown(content)}`.toLowerCase();
					return searchableText.includes(this.searchQuery);
				});
			}

			if (this.filterTag) {
				files = files.filter((f: TFile) => {
					const content = fileContents.get(f.path) || '';
					const tags = extractTags(content);
					// Support nested tags: #parent should match #parent, #parent/child, etc.
					return tags.some(tag => tagMatchesFilter(tag, this.filterTag!));
				});
			}

			// Apply folder filter (includes subfolders)
			if (this.filterFolder) {
				files = files.filter((f: TFile) => {
					const fileFolderPath = f.parent?.path || '';
					// Include files in the folder and all subfolders
					return isFileInFolderOrSubfolder(fileFolderPath, this.filterFolder!);
				});
			}

			// Apply type filter
			if (this.filterType) {
				files = files.filter((f: TFile) => {
					return f.extension.toLowerCase() === this.filterType;
				});
			}

			// Apply color filter
			if (this.filterColor) {
				files = files.filter((f: TFile) => {
					const savedColor = this.plugin.data.noteColors[f.path];
					if (this.filterColor === 'none') {
						return !savedColor;
					}
					return savedColor === this.filterColor;
				});
			}

			// Limit after filtering
			files = files.slice(0, this.plugin.data.maxNotes);

			// Separate and sort files by pin status
			const sortByOrder = (a: TFile, b: TFile) => {
				const aOrder = this.plugin.getOrderIndex(a.path);
				const bOrder = this.plugin.getOrderIndex(b.path);

				if (aOrder > -1 && bOrder > -1) return aOrder - bOrder;
				if (aOrder > -1) return -1;
				if (bOrder > -1) return 1;
				return b.stat.mtime - a.stat.mtime;
			};

			const pinnedFiles = files.filter(f => this.plugin.isPinned(f.path)).sort(sortByOrder);
			const unpinnedFiles = files.filter(f => !this.plugin.isPinned(f.path)).sort(sortByOrder);

			// Apply pinned filter
			let displayPinned = pinnedFiles;
			let displayUnpinned = unpinnedFiles;
			if (this.filterPinned === 'pinned') {
				displayUnpinned = [];
			} else if (this.filterPinned === 'unpinned') {
				displayPinned = [];
			}

			// Store the combined order for drag-and-drop
			this.currentFiles = [...displayPinned, ...displayUnpinned];

			if (displayPinned.length === 0 && displayUnpinned.length === 0) {
				const emptyState = this.miniNotesGrid.createDiv({ cls: 'dashboard-empty-state' });
				emptyState.createEl('h3', { text: 'No matching notes' });
				emptyState.createEl('p', { text: 'Try adjusting your filters' });
				return;
			}

			let globalIndex = 0;

			// Check if we need sections (both pinned and unpinned exist)
			const needsSections = displayPinned.length > 0 && displayUnpinned.length > 0;

			if (needsSections) {
				// Render pinned section
				if (displayPinned.length > 0) {
					const pinnedGrid = this.miniNotesGrid.createDiv({ cls: 'mini-notes-grid-section' });
					for (const file of displayPinned) {
						const card = await this.createCard(file, globalIndex++);
						if (card) pinnedGrid.appendChild(card);
					}
				}

				// Separator line between sections
				this.miniNotesGrid.createDiv({ cls: 'section-separator' });

				// Render all notes section
				if (displayUnpinned.length > 0) {
					const notesGrid = this.miniNotesGrid.createDiv({ cls: 'mini-notes-grid-section' });
					for (const file of displayUnpinned) {
						const card = await this.createCard(file, globalIndex++);
						if (card) notesGrid.appendChild(card);
					}
				}
			} else {
				// Single section without header
				const singleGrid = this.miniNotesGrid.createDiv({ cls: 'mini-notes-grid-section' });
				for (const file of [...displayPinned, ...displayUnpinned]) {
					const card = await this.createCard(file, globalIndex++);
					if (card) singleGrid.appendChild(card);
				}
			}
		} catch (error) {
			console.error('Error rendering cards:', error);
			const errorMsg = this.miniNotesGrid.createDiv({ cls: 'dashboard-error' });
			const errorText = errorMsg.createEl('p');
			errorText.createSpan({ text: 'Failed to render cards. Please open the console (Ctrl+Shift+I), screenshot the error, and ' });
			const link = errorText.createEl('a', {
				text: 'Report it on GitHub',
				href: 'https://github.com/rknastenka/mini-notes/issues'
			});
			link.setAttribute('target', '_blank');
			errorText.createSpan({ text: '.' });
		}
	}

	async createCard(file: TFile, index: number): Promise<HTMLElement | null> {
		const card = document.createElement('div');
		card.addClass('dashboard-card');
		card.setAttribute('data-path', file.path);
		card.setAttribute('data-index', index.toString());
		card.setAttribute('draggable', 'true');

		try {
			// Get content and preview
			const content = await this.app.vault.cachedRead(file);
			const cleanContent = stripMarkdown(content);
			const previewLength = Math.min(cleanContent.length, MAX_PREVIEW_LENGTH);
			const previewText = getPreviewText(content, previewLength);
			// Keep markdown formatting for rendering (tables, code blocks, etc.)
			const markdownPreview = getMarkdownForPreview(content, previewLength);

			// Dynamic sizing based on content length - more granular
			const contentLen = cleanContent.length;
			if (contentLen > CARD_SIZE.XL) {
				card.addClass('card-xl');
			} else if (contentLen > CARD_SIZE.LARGE) {
				card.addClass('card-large');
			} else if (contentLen > CARD_SIZE.MEDIUM) {
				card.addClass('card-medium');
			} else if (contentLen > CARD_SIZE.SMALL) {
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

			// Apply max height limit
			card.style.maxHeight = `${MAX_CARD_HEIGHT}px`;
			// Required to prevent card content from exceeding max height - dynamic styling needed per card
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			card.style.overflow = 'hidden';

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

			// Create color palette dropdown using CSS variables
			const pastelColors = [
				'var(--pastel-pink)',     // Pink
				'var(--pastel-peach)',    // Peach
				'var(--pastel-yellow)',   // Yellow
				'var(--pastel-green)',    // Green
				'var(--pastel-blue)',     // Blue
				'var(--pastel-purple)',   // Purple
				'var(--pastel-magenta)',  // Magenta
				'var(--pastel-gray)'      // Gray (remove color)
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

				colorCircle.addEventListener('click', (e: MouseEvent) => {
					e.stopPropagation();

					void (async () => {
						if (index === pastelColors.length - 1) {
							// Remove color - required to reset dynamically applied background color
							// eslint-disable-next-line obsidianmd/no-static-styles-assignment
							card.style.backgroundColor = '';
							delete this.plugin.data.noteColors[file.path];
						} else {
							// Apply color using CSS variable
							card.style.backgroundColor = color;
							// Store the CSS variable name so it adapts to theme changes
							this.plugin.data.noteColors[file.path] = color;
						}

						await this.plugin.savePluginData();
						this.closeAllCardColorDropdowns();
					})();
				});
			});

			// Toggle dropdown on click - close others first
			colorBtn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				const shouldOpen = !colorDropdown.hasClass('show');
				this.closeAllCardColorDropdowns(shouldOpen ? colorDropdown : undefined);
				colorDropdown.toggleClass('show', shouldOpen);
				this.activeCardColorDropdown = shouldOpen ? colorDropdown : null;
			});

			// Card header with file info
			const cardHeader = card.createDiv({ cls: 'card-header' });

			// Title with search highlighting
			const title = cardHeader.createEl('h3', { cls: 'card-title' });
			if (this.searchQuery && file.basename.toLowerCase().includes(this.searchQuery)) {
				this.highlightText(title, file.basename, this.searchQuery);
			} else {
				title.textContent = file.basename;
			}
			title.setAttribute('title', file.basename);

			// Card content (preview) - render with Obsidian's markdown renderer
			const cardContent = card.createDiv({ cls: 'card-content' });

			// Check if this is a PDF file
			const isPdf = file.extension.toLowerCase() === 'pdf';

			if (isPdf) {
				// PDF preview
				const pdfPreview = cardContent.createDiv({ cls: 'card-pdf-preview' });
				const pdfIcon = pdfPreview.createDiv({ cls: 'pdf-icon' });
				setIcon(pdfIcon, 'file-text');
				pdfPreview.createEl('span', { text: 'PDF document', cls: 'pdf-label' });
				pdfPreview.createEl('span', { text: this.formatFileSize(file.stat.size), cls: 'pdf-size' });
				card.addClass('card-pdf');
			} else if (previewText.trim()) {
				const previewContainer = cardContent.createDiv({ cls: 'card-preview' });

				// Apply search highlighting if there's a search query
				if (this.searchQuery) {
					// Render as text with highlighting for search results
					const strippedContent = stripMarkdown(content).substring(0, MAX_PREVIEW_LENGTH);
					this.highlightText(previewContainer, strippedContent, this.searchQuery);
					previewContainer.addClass('search-highlighted');
				} else {
					// Render markdown natively with Obsidian's renderer (preserves tables, code, etc.)
					await MarkdownRenderer.render(
						this.app,
						markdownPreview,
						previewContainer,
						file.path,
						this
					);
				}
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
					tagsContainer.createSpan({ cls: 'card-tag', text: formatTagForDisplay(tag) });
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
			card.addEventListener('drop', (e: DragEvent) => void this.handleDrop(e, card));
		} catch (error) {
			console.warn(`Skipping card for ${file.path} due to error:`, error);
			// Return null to skip this card entirely
			return null;
		}

		return card;
	}

	// Card color dropdown management
	private closeAllCardColorDropdowns(except?: HTMLElement) {
		const dropdowns = this.miniNotesGrid.querySelectorAll('.card-color-dropdown.show');
		dropdowns.forEach(dropdown => {
			if (dropdown !== except) {
				dropdown.classList.remove('show');
			}
		});
		if (!except) {
			this.activeCardColorDropdown = null;
		}
	}

	// Drag and Drop Handlers
	handleDragStart(e: DragEvent, card: HTMLElement) {
		this.draggedCard = card;
		this.dragOverTargetCard = null;
		this.pendingDragTargetCard = null;
		this.pendingDragClientY = null;
		card.classList.add('dragging');

		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', card.getAttribute('data-path') || '');
		}
	}

	handleDragEnd(e: DragEvent, card: HTMLElement) {
		card.classList.remove('dragging');
		if (this.dragFrameId !== null) {
			window.cancelAnimationFrame(this.dragFrameId);
			this.dragFrameId = null;
		}
		this.pendingDragTargetCard = null;
		this.pendingDragClientY = null;
		this.setDragOverTarget(null);
		this.draggedCard = null;
	}

	private setDragOverTarget(target: HTMLElement | null) {
		if (this.dragOverTargetCard && this.dragOverTargetCard !== target) {
			this.dragOverTargetCard.classList.remove('drag-over');
		}
		this.dragOverTargetCard = target;
		if (target) {
			target.classList.add('drag-over');
		}
	}

	private applyPendingDragReorder() {
		const targetCard = this.pendingDragTargetCard;
		if (!targetCard || !this.draggedCard || targetCard === this.draggedCard) {
			return;
		}
		this.setDragOverTarget(targetCard);
	}

	handleDragOver(e: DragEvent, card: HTMLElement) {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}

		if (!this.draggedCard || card === this.draggedCard) return;

		this.pendingDragTargetCard = card;
		this.pendingDragClientY = e.clientY;

		if (this.dragFrameId === null) {
			this.dragFrameId = window.requestAnimationFrame(() => {
				this.dragFrameId = null;
				this.applyPendingDragReorder();
			});
		}
	}

	handleDrop(e: DragEvent, targetCard: HTMLElement) {
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

	// Helper method to highlight search text
	private highlightText(container: HTMLElement, text: string, query: string) {
		const lowerText = text.toLowerCase();
		const lowerQuery = query.toLowerCase();
		let lastIndex = 0;
		let matchIndex = lowerText.indexOf(lowerQuery);

		while (matchIndex !== -1) {
			// Add text before match
			if (matchIndex > lastIndex) {
				container.appendText(text.substring(lastIndex, matchIndex));
			}
			// Add highlighted match
			const matchText = text.substring(matchIndex, matchIndex + query.length);
			container.createEl('mark', { text: matchText, cls: 'search-highlight' });
			lastIndex = matchIndex + query.length;
			matchIndex = lowerText.indexOf(lowerQuery, lastIndex);
		}
		// Add remaining text
		if (lastIndex < text.length) {
			container.appendText(text.substring(lastIndex));
		}
	}

	// Helper method to format file size
	private formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async onClose() {
		// Cancel any pending animation frame
		if (this.dragFrameId !== null) {
			window.cancelAnimationFrame(this.dragFrameId);
			this.dragFrameId = null;
		}

		// Event cleanup handled automatically by registerEvent
		this.contentEl.empty();
	}
}
