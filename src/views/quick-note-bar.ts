import { setIcon, Notice } from 'obsidian';
import type VisualDashboardPlugin from '../main';

export class QuickNoteBar {
    private plugin: VisualDashboardPlugin;
    private container: HTMLElement;
    private isExpanded: boolean = false;
    private titleInput: HTMLInputElement | null = null;
    private contentInput: HTMLTextAreaElement | null = null;
    private expandHandler: (() => void) | null = null;

    constructor(plugin: VisualDashboardPlugin) {
        this.plugin = plugin;
        this.container = createDiv({ cls: 'quick-note-bar' });
    }

    getElement(): HTMLElement {
        return this.container;
    }

    render() {
        this.container.empty();

        if (!this.isExpanded) {
            this.renderCollapsed();
        } else {
            this.renderExpanded();
        }
    }

    private renderCollapsed() {
        const placeholder = this.container.createDiv({ cls: 'quick-note-placeholder' });
        placeholder.textContent = 'Take a note...';

        // Expand on click
        this.expandHandler = () => {
            this.expand();
        };
        this.container.addEventListener('click', this.expandHandler);
    }

    private renderExpanded() {
        this.container.addClass('expanded');

        // Title input
        this.titleInput = this.container.createEl('input', {
            cls: 'quick-note-title',
            attr: { placeholder: 'Title', type: 'text' }
        });

        // Content textarea
        this.contentInput = this.container.createEl('textarea', {
            cls: 'quick-note-content',
            attr: { placeholder: 'Take a note...' }
        });

        // Auto-resize textarea
        this.contentInput.addEventListener('input', () => {
            if (this.contentInput) {
                this.contentInput.style.height = 'auto';
                this.contentInput.style.height = this.contentInput.scrollHeight + 'px';
            }
        });

        // Actions bar
        const actionsBar = this.container.createDiv({ cls: 'quick-note-actions-bar' });

        // Right side buttons
        const rightActions = actionsBar.createDiv({ cls: 'quick-note-actions-right' });

        const closeBtn = rightActions.createEl('button', {
            text: 'Close',
            cls: 'quick-note-button'
        });
        closeBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.collapse();
        });

        const saveBtn = rightActions.createEl('button', {
            text: 'Save',
            cls: 'quick-note-button quick-note-button-primary'
        });
        saveBtn.addEventListener('click', async (e: MouseEvent) => {
            e.stopPropagation();
            await this.saveNote();
        });

        // Close on Escape for both inputs
        this.titleInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.collapse();
            }
            // Move to content on Enter
            if (e.key === 'Enter') {
                e.preventDefault();
                this.contentInput?.focus();
            }
        });

        this.contentInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                this.collapse();
            }
        });

        // Prevent clicks on inputs from bubbling
        this.titleInput.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
        });

        this.contentInput.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
        });

        // Focus on title first
        setTimeout(() => {
            this.titleInput?.focus();
        }, 0);
    }

    private expand() {
        // Remove the expand handler before re-rendering
        if (this.expandHandler) {
            this.container.removeEventListener('click', this.expandHandler);
            this.expandHandler = null;
        }
        this.isExpanded = true;
        this.render();
    }

    private collapse() {
        this.isExpanded = false;
        this.titleInput = null;
        this.contentInput = null;
        this.container.removeClass('expanded');
        this.render();
    }

    private async saveNote() {
        let title = this.titleInput?.value.trim() || '';
        const content = this.contentInput?.value.trim() || '';

        if (!title && !content) {
            new Notice('Please enter a title or content');
            return;
        }

        // If no title, use first few words from content
        if (!title && content) {
            const words = content.split(/\s+/).slice(0, 5);
            title = words.join(' ');
            if (content.split(/\s+/).length > 5) {
                title += '...';
            }
        }

        try {
            await this.plugin.createQuickNote(title, content);
            this.collapse();
        } catch (error) {
            console.error('Error creating quick note:', error);
            new Notice('Failed to create note');
        }
    }
}

export class QuickNoteModal {
    private plugin: VisualDashboardPlugin;
    private modalEl: HTMLElement | null = null;
    private titleInput: HTMLInputElement | null = null;
    private contentInput: HTMLTextAreaElement | null = null;

    constructor(plugin: VisualDashboardPlugin) {
        this.plugin = plugin;
    }

    open() {
        // Create backdrop
        const backdrop = document.body.createDiv({ cls: 'quick-note-modal-backdrop' });

        // Create modal
        this.modalEl = backdrop.createDiv({ cls: 'quick-note-modal' });

        // Header
        const header = this.modalEl.createDiv({ cls: 'quick-note-modal-header' });

        const title = header.createDiv({ cls: 'quick-note-modal-title' });
        title.textContent = 'New Note';

        const closeIcon = header.createDiv({ cls: 'quick-note-icon quick-note-modal-close' });
        setIcon(closeIcon, 'x');
        closeIcon.addEventListener('click', () => {
            this.close();
        });

        // Body
        const body = this.modalEl.createDiv({ cls: 'quick-note-modal-body' });

        // Title input
        this.titleInput = body.createEl('input', {
            cls: 'quick-note-title',
            attr: { placeholder: 'Title', type: 'text' }
        });

        // Content textarea
        this.contentInput = body.createEl('textarea', {
            cls: 'quick-note-content',
            attr: { placeholder: 'Take a note...' }
        });

        // Auto-resize textarea
        this.contentInput.addEventListener('input', () => {
            if (this.contentInput) {
                this.contentInput.style.height = 'auto';
                this.contentInput.style.height = this.contentInput.scrollHeight + 'px';
            }
        });

        // Actions bar
        const actionsBar = body.createDiv({ cls: 'quick-note-actions-bar' });

        // Footer
        const footer = this.modalEl.createDiv({ cls: 'quick-note-modal-footer' });

        const saveBtn = footer.createEl('button', {
            text: 'Save',
            cls: 'quick-note-button quick-note-button-primary'
        });
        saveBtn.addEventListener('click', async () => {
            await this.saveNote();
        });

        // Close on backdrop click
        backdrop.addEventListener('click', (e: MouseEvent) => {
            if (e.target === backdrop) {
                this.close();
            }
        });

        // Close on Escape
        document.addEventListener('keydown', this.handleEscape);

        // Prevent modal content clicks from closing
        this.modalEl.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
        });

        // Move to content on Enter in title
        this.titleInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.contentInput?.focus();
            }
        });

        // Focus on title first
        setTimeout(() => {
            this.titleInput?.focus();
        }, 100);
    }

    private handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            this.close();
        }
    };

    close() {
        document.removeEventListener('keydown', this.handleEscape);
        const backdrop = document.querySelector('.quick-note-modal-backdrop');
        if (backdrop) {
            backdrop.remove();
        }
        this.modalEl = null;
        this.titleInput = null;
        this.contentInput = null;
    }

    private async saveNote() {
        let title = this.titleInput?.value.trim() || '';
        const content = this.contentInput?.value.trim() || '';

        if (!title && !content) {
            new Notice('Please enter a title or content');
            return;
        }

        // If no title, use first few words from content
        if (!title && content) {
            const words = content.split(/\s+/).slice(0, 5);
            title = words.join(' ');
            if (content.split(/\s+/).length > 5) {
                title += '...';
            }
        }

        try {
            await this.plugin.createQuickNote(title, content);
            this.close();
        } catch (error) {
            console.error('Error creating quick note:', error);
            new Notice('Failed to create note');
        }
    }
}
