import { ItemView, TFile, WorkspaceLeaf, setIcon, MarkdownRenderer, Menu } from 'obsidian';
import type VisualDashboardPlugin from '../main';
import { VIEW_TYPE_SIDEBAR } from '../types';
import { extractTags, stripMarkdown } from '../utils/markdown';
import { formatDate } from '../utils/date';
import { DEBOUNCE_REFRESH_MS } from '../constants';

export class SidebarView extends ItemView {
    private notesListContainer!: HTMLElement;
    private plugin: VisualDashboardPlugin;
    private currentFiles: TFile[] = [];
    private settingsChangedHandler: () => void;
    private refreshTimeoutId: number | null = null;
    private eventsRegistered = false;

    // Filter state
    private filterPinned: 'all' | 'pinned' | 'unpinned' = 'all';
    private filterTag: string | null = null;
    private allTags: string[] = [];
    private searchQuery: string = '';

    constructor(leaf: WorkspaceLeaf, plugin: VisualDashboardPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.settingsChangedHandler = () => {
            void this.refreshView();
        };
    }

    getViewType(): string {
        return VIEW_TYPE_SIDEBAR;
    }

    getDisplayText(): string {
        return 'Mini notes list';
    }

    getIcon(): string {
        return 'list';
    }

    async onOpen() {
        const container = this.contentEl;
        container.empty();
        container.addClass('mini-notes-sidebar-container');

        // Create header
        const header = container.createDiv({ cls: 'sidebar-header' });

        // Title
        const title = header.createEl('h2', { text: 'Mini Notes', cls: 'sidebar-title' });

        // Search bar
        const searchContainer = container.createDiv({ cls: 'sidebar-search-container' });
        const searchInput = searchContainer.createEl('input', {
            cls: 'sidebar-search-input',
            attr: {
                placeholder: 'Search notes...',
                type: 'text'
            }
        });

        searchInput.addEventListener('input', (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            void this.renderNotesList();
        });

        // Controls
        const controls = container.createDiv({ cls: 'sidebar-controls' });

        // Filter buttons
        const filterGroup = controls.createDiv({ cls: 'filter-group' });

        // Pin filter
        const pinBtn = filterGroup.createDiv({ cls: 'filter-icon' });
        setIcon(pinBtn, 'pin');
        pinBtn.setAttribute('aria-label', 'Filter pinned');
        pinBtn.addEventListener('click', () => {
            if (this.filterPinned === 'all') {
                this.filterPinned = 'pinned';
                pinBtn.addClass('active');
            } else if (this.filterPinned === 'pinned') {
                this.filterPinned = 'unpinned';
            } else {
                this.filterPinned = 'all';
                pinBtn.removeClass('active');
            }
            void this.renderNotesList();
        });

        // Tag filter
        const tagBtn = filterGroup.createDiv({ cls: 'filter-icon' });
        setIcon(tagBtn, 'tag');
        tagBtn.setAttribute('aria-label', 'Filter by tag');
        tagBtn.addEventListener('click', () => {
            const menu = new Menu();

            // Add "All tags" option
            menu.addItem((item) => {
                item.setTitle('All tags')
                    .setChecked(this.filterTag === null)
                    .onClick(() => {
                        this.filterTag = null;
                        tagBtn.removeClass('active');
                        void this.renderNotesList();
                    });
            });

            // Add separator
            menu.addSeparator();

            // Add tags
            this.allTags.forEach(tag => {
                menu.addItem((item) => {
                    item.setTitle(tag)
                        .setChecked(this.filterTag === tag)
                        .onClick(() => {
                            this.filterTag = tag;
                            tagBtn.addClass('active');
                            void this.renderNotesList();
                        });
                });
            });

            menu.showAtMouseEvent(new MouseEvent('click'));
        });

        // Full view button
        const fullViewBtn = filterGroup.createDiv({ cls: 'filter-icon' });
        setIcon(fullViewBtn, 'layout-dashboard');
        fullViewBtn.setAttribute('aria-label', 'Open full view');
        fullViewBtn.addEventListener('click', () => {
            void this.plugin.activateView();
        });

        // New note button
        const newNoteBtn = controls.createDiv({ cls: 'filter-icon new-note-btn' });
        setIcon(newNoteBtn, 'plus');
        newNoteBtn.setAttribute('aria-label', 'Create new mini note');
        newNoteBtn.addEventListener('click', () => {
            void this.plugin.createMiniNote();
        });

        // Notes list container
        this.notesListContainer = container.createDiv({ cls: 'sidebar-notes-list' });

        // Load and render notes
        await this.loadNotes();
        await this.renderNotesList();

        // Register events
        if (!this.eventsRegistered) {
            this.registerEvent(
                this.app.vault.on('modify', (file) => {
                    if (file instanceof TFile) {
                        void this.scheduleRefresh();
                    }
                })
            );

            this.registerEvent(
                this.app.vault.on('delete', (file) => {
                    if (file instanceof TFile) {
                        void this.scheduleRefresh();
                    }
                })
            );

            this.registerEvent(
                this.app.vault.on('create', (file) => {
                    if (file instanceof TFile) {
                        void this.scheduleRefresh();
                    }
                })
            );

            this.registerEvent(
                this.app.vault.on('rename', (file) => {
                    if (file instanceof TFile) {
                        void this.scheduleRefresh();
                    }
                })
            );

            this.registerEvent(
                // @ts-ignore - Custom event type
                this.app.workspace.on('mini-notes:settings-changed', this.settingsChangedHandler)
            );

            this.eventsRegistered = true;
        }
    }

    async loadNotes() {
        try {
            const sourceFolder = this.plugin.data.sourceFolder;
            const maxNotes = this.plugin.data.maxNotes || 150;

            // Get all files matching allowed extensions
            const allowedExts = this.plugin.data.allowedExtensions.length > 0
                ? this.plugin.data.allowedExtensions
                : ['md']; // Default to .md if no extensions configured

            let files: TFile[] = this.app.vault.getFiles().filter((file: TFile) => {
                const ext = file.extension.toLowerCase();
                return allowedExts.includes(ext);
            });

            // Filter out Excalidraw files (they have .md extension but are not regular markdown)
            files = files.filter((file: TFile) => {
                const path = file.path.toLowerCase();
                // Check for .excalidraw extension or .excalidraw.md pattern
                return !path.endsWith('.excalidraw.md') && !path.endsWith('.excalidraw');
            });

            // Filter by source folder
            if (sourceFolder !== '/') {
                const normalizedFolder = sourceFolder.endsWith('/') ? sourceFolder.slice(0, -1) : sourceFolder;
                files = files.filter(file => {
                    const filePath = file.path;
                    return filePath.startsWith(normalizedFolder + '/') || filePath === normalizedFolder;
                });
            }

            // Filter by excluded folders
            if (this.plugin.data.excludedFolders && this.plugin.data.excludedFolders.length > 0) {
                files = files.filter(file => {
                    const filePath = file.path;
                    return !this.plugin.data.excludedFolders.some(excludedFolder => {
                        const normalizedExcluded = excludedFolder.endsWith('/') ? excludedFolder.slice(0, -1) : excludedFolder;
                        return filePath.startsWith(normalizedExcluded + '/') || filePath === normalizedExcluded;
                    });
                });
            }

            // Collect all tags
            this.allTags = [];
            for (const file of files) {
                const content = await this.app.vault.cachedRead(file);
                const tags = extractTags(content);
                tags.forEach(tag => {
                    if (!this.allTags.includes(tag)) {
                        this.allTags.push(tag);
                    }
                });
            }
            this.allTags.sort();

            // Sort by modification time (newest first)
            files.sort((a, b) => b.stat.mtime - a.stat.mtime);

            // Apply custom order if exists
            const orderedPaths = this.plugin.data.noteOrder;
            if (orderedPaths && orderedPaths.length > 0) {
                files.sort((a, b) => {
                    const aIndex = orderedPaths.indexOf(a.path);
                    const bIndex = orderedPaths.indexOf(b.path);

                    // If both have order, use that
                    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                    // If only one has order, prioritize it
                    if (aIndex !== -1) return -1;
                    if (bIndex !== -1) return 1;
                    // Otherwise maintain mtime order
                    return b.stat.mtime - a.stat.mtime;
                });
            }

            // Move pinned notes to the top
            const pinnedPaths = this.plugin.data.pinnedNotes || [];
            files.sort((a, b) => {
                const aIsPinned = pinnedPaths.includes(a.path);
                const bIsPinned = pinnedPaths.includes(b.path);
                if (aIsPinned && !bIsPinned) return -1;
                if (!aIsPinned && bIsPinned) return 1;
                return 0;
            });

            // Limit number of files
            if (files.length > maxNotes) {
                files = files.slice(0, maxNotes);
            }

            this.currentFiles = files;
        } catch (error) {
            console.error('Error loading notes:', error);
            this.currentFiles = [];
        }
    }

    async renderNotesList() {
        this.notesListContainer.empty();

        try {
            // Filter files based on current filters
            let filteredFiles = [...this.currentFiles];

            // Apply pin filter
            if (this.filterPinned === 'pinned') {
                filteredFiles = filteredFiles.filter(file => this.plugin.isPinned(file.path));
            } else if (this.filterPinned === 'unpinned') {
                filteredFiles = filteredFiles.filter(file => !this.plugin.isPinned(file.path));
            }

            // Apply tag filter
            if (this.filterTag) {
                const tagFilteredFiles: TFile[] = [];
                for (const file of filteredFiles) {
                    const content = await this.app.vault.cachedRead(file);
                    const tags = extractTags(content);
                    if (tags.includes(this.filterTag)) {
                        tagFilteredFiles.push(file);
                    }
                }
                filteredFiles = tagFilteredFiles;
            }

            // Apply search filter
            if (this.searchQuery) {
                const searchFilteredFiles: TFile[] = [];
                for (const file of filteredFiles) {
                    const content = await this.app.vault.cachedRead(file);
                    const searchableText = `${file.basename} ${stripMarkdown(content)}`.toLowerCase();
                    if (searchableText.includes(this.searchQuery)) {
                        searchFilteredFiles.push(file);
                    }
                }
                filteredFiles = searchFilteredFiles;
            }

            // Show count
            const countEl = this.notesListContainer.createDiv({ cls: 'sidebar-notes-count' });
            countEl.textContent = `${filteredFiles.length} note${filteredFiles.length !== 1 ? 's' : ''}`;

            // Render each note
            for (const file of filteredFiles) {
                const noteItem = await this.createNoteItem(file);
                if (noteItem) {
                    this.notesListContainer.appendChild(noteItem);
                }
            }

            if (filteredFiles.length === 0) {
                this.notesListContainer.createDiv({
                    cls: 'sidebar-empty-state',
                    text: 'No notes found'
                });
            }
        } catch (error) {
            console.error('Error rendering notes list:', error);
            this.notesListContainer.createDiv({
                cls: 'sidebar-error',
                text: 'Error loading notes'
            });
        }
    }

    async createNoteItem(file: TFile): Promise<HTMLElement | null> {
        try {
            const noteItem = document.createElement('div');
            noteItem.addClass('sidebar-note-item');
            noteItem.setAttribute('data-path', file.path);

            // Check if pinned
            const isPinned = this.plugin.isPinned(file.path);
            if (isPinned) {
                noteItem.addClass('note-pinned');
            }

            // Apply saved color if exists
            const savedColor = this.plugin.data.noteColors[file.path];
            if (savedColor) {
                noteItem.style.backgroundColor = savedColor;
            }

            // Get content for preview
            const content = await this.app.vault.cachedRead(file);
            const cleanContent = stripMarkdown(content);
            const previewText = cleanContent.slice(0, 150).trim() || 'Empty note...';

            // Note header
            const noteHeader = noteItem.createDiv({ cls: 'note-item-header' });

            // Title
            const titleContainer = noteHeader.createDiv({ cls: 'note-item-title-container' });
            const title = titleContainer.createSpan({
                text: file.basename,
                cls: 'note-item-title'
            });

            // Pin indicator
            if (isPinned) {
                const pinIcon = titleContainer.createSpan({ cls: 'note-item-pin-icon' });
                setIcon(pinIcon, 'pin');
            }

            // Actions (show on hover)
            const actions = noteHeader.createDiv({ cls: 'note-item-actions' });

            // Open in new pane button
            const openBtn = actions.createDiv({ cls: 'note-item-action-btn' });
            setIcon(openBtn, 'external-link');
            openBtn.setAttribute('aria-label', 'Open in new pane');
            openBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const leaf = this.app.workspace.getLeaf('tab');
                void leaf.openFile(file);
            });

            // More options button
            const moreBtn = actions.createDiv({ cls: 'note-item-action-btn' });
            setIcon(moreBtn, 'more-vertical');
            moreBtn.setAttribute('aria-label', 'More options');
            moreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = new Menu();

                menu.addItem((item) => {
                    item.setTitle(isPinned ? 'Unpin note' : 'Pin note')
                        .setIcon('pin')
                        .onClick(() => {
                            void this.plugin.togglePin(file.path).then(() => {
                                void this.renderNotesList();
                            });
                        });
                });

                // Color submenu
                const pastelColors = [
                    { name: 'Pink', color: 'var(--pastel-pink)' },
                    { name: 'Peach', color: 'var(--pastel-peach)' },
                    { name: 'Yellow', color: 'var(--pastel-yellow)' },
                    { name: 'Green', color: 'var(--pastel-green)' },
                    { name: 'Blue', color: 'var(--pastel-blue)' },
                    { name: 'Purple', color: 'var(--pastel-purple)' },
                    { name: 'Magenta', color: 'var(--pastel-magenta)' },
                    { name: 'Remove color', color: '' }
                ];

                pastelColors.forEach(({ name, color }) => {
                    menu.addItem((item) => {
                        item.setTitle(name)
                            .setIcon(color ? 'palette' : 'eraser')
                            .onClick(() => {
                                if (color) {
                                    noteItem.style.backgroundColor = color;
                                    this.plugin.data.noteColors[file.path] = color;
                                } else {
                                    noteItem.style.backgroundColor = '';
                                    delete this.plugin.data.noteColors[file.path];
                                }
                                void this.plugin.savePluginData();
                            });
                    });
                });

                menu.addSeparator();

                menu.addItem((item) => {
                    item.setTitle('Delete note')
                        .setIcon('trash')
                        .onClick(() => {
                            void this.app.vault.delete(file);
                        });
                });

                menu.showAtMouseEvent(e as MouseEvent);
            });

            // Preview text
            const preview = noteItem.createDiv({ cls: 'note-item-preview' });
            preview.textContent = previewText;

            // Footer with metadata
            const footer = noteItem.createDiv({ cls: 'note-item-footer' });

            // Tags
            const tags = extractTags(content);
            if (tags.length > 0) {
                const tagsContainer = footer.createDiv({ cls: 'note-item-tags' });
                tags.slice(0, 2).forEach(tag => {
                    tagsContainer.createSpan({ cls: 'note-item-tag', text: tag });
                });
                if (tags.length > 2) {
                    tagsContainer.createSpan({ cls: 'note-item-tag-more', text: `+${tags.length - 2}` });
                }
            }

            // Date
            const date = footer.createSpan({ cls: 'note-item-date' });
            date.textContent = formatDate(file.stat.mtime);

            // Click handler to open the note
            noteItem.addEventListener('click', () => {
                const leaf = this.app.workspace.getLeaf(false);
                void leaf.openFile(file);
            });

            return noteItem;
        } catch (error) {
            console.warn(`Skipping note item for ${file.path} due to error:`, error);
            return null;
        }
    }

    async scheduleRefresh() {
        if (this.refreshTimeoutId !== null) {
            window.clearTimeout(this.refreshTimeoutId);
        }

        this.refreshTimeoutId = window.setTimeout(() => {
            void this.refreshView();
            this.refreshTimeoutId = null;
        }, DEBOUNCE_REFRESH_MS);
    }

    async refreshView() {
        await this.loadNotes();
        await this.renderNotesList();
    }

    async onClose() {
        this.contentEl.empty();
    }
}
