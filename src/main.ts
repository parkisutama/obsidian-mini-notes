import { Plugin, WorkspaceLeaf, addIcon, Notice, normalizePath, TAbstractFile, TFile } from 'obsidian';
import { DashboardData, DEFAULT_DATA, VIEW_TYPE_VISUAL_DASHBOARD, VIEW_TYPE_SIDEBAR, DASHBOARD_ICON } from './types';
import { VisualDashboardView } from './views/dashboard-view';
import { SidebarView } from './views/sidebar-view';
import { MiniNotesSettingTab } from './settings';

export default class VisualDashboardPlugin extends Plugin {
	data: DashboardData = DEFAULT_DATA;

	async onload() {
		try {
			await this.loadPluginData();
			await this.ensureMiniNotesFolder();

			// Register file rename handler to preserve note colors, pins, and order
			this.registerEvent(
				this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
					this.handleFileRename(file, oldPath);
				})
			);

			// Register file delete handler to clean up stored data
			this.registerEvent(
				this.app.vault.on('delete', (file: TAbstractFile) => {
					this.handleFileDelete(file);
				})
			);

			// Register the custom icon
			addIcon('dashboard-grid', DASHBOARD_ICON);

			// Register the custom views
			this.registerView(
				VIEW_TYPE_VISUAL_DASHBOARD,
				(leaf) => new VisualDashboardView(leaf, this)
			);

			this.registerView(
				VIEW_TYPE_SIDEBAR,
				(leaf) => new SidebarView(leaf, this)
			);

			// Add ribbon icon to activate the dashboard view
			this.addRibbonIcon('dashboard-grid', 'Open mini notes', async () => {
				// Open based on default view type setting
				if (this.data.defaultViewType === 'sidebar') {
					await this.activateSidebarView();
				} else {
					await this.activateView();
				}
			});

			// Add ribbon icon to activate the sidebar view
			this.addRibbonIcon('list', 'Open mini notes sidebar', async () => {
				await this.activateSidebarView();
			});

			// Add command to open the dashboard
			this.addCommand({
				id: 'open-visual-dashboard',
				name: 'Open view',
				callback: async () => {
					await this.activateView();
				}
			});

			// Add command to open the sidebar
			this.addCommand({
				id: 'open-sidebar-view',
				name: 'Open sidebar view',
				callback: async () => {
					await this.activateSidebarView();
				}
			});

			// Add command to create a new mini note
			this.addCommand({
				id: 'create-mini-note',
				name: 'Create new mini note',
				callback: async () => {
					await this.createMiniNote();
				}
			});

			// Add settings tab
			this.addSettingTab(new MiniNotesSettingTab(this.app, this));
		} catch (error) {
			console.error('Error loading Mini Notes plugin:', error);
		}
	}

	async loadPluginData() {
		try {
			const loadedData = await this.loadData() as DashboardData | null;
			this.data = Object.assign({}, DEFAULT_DATA, loadedData ?? {});

			// Migration: if sourceFolder is empty string, use the new default
			if (this.data.sourceFolder === '') {
				this.data.sourceFolder = DEFAULT_DATA.sourceFolder;
				await this.savePluginData();
			}
		} catch (error) {
			console.error('Error loading plugin data, using defaults:', error);
			this.data = DEFAULT_DATA;
		}
	}

	async savePluginData() {
		try {
			await this.saveData(this.data);
		} catch (error) {
			console.error('Error saving plugin data:', error);
		}
	}

	isPinned(filePath: string): boolean {
		return this.data.pinnedNotes.includes(filePath);
	}

	async togglePin(filePath: string): Promise<boolean> {
		try {
			const index = this.data.pinnedNotes.indexOf(filePath);
			if (index > -1) {
				this.data.pinnedNotes.splice(index, 1);
				await this.savePluginData();
				return false;
			} else {
				this.data.pinnedNotes.push(filePath);
				await this.savePluginData();
				return true;
			}
		} catch (error) {
			console.error('Error toggling pin:', error);
			return this.isPinned(filePath);
		}
	}

	getOrderIndex(filePath: string): number {
		return this.data.noteOrder.indexOf(filePath);
	}

	async updateOrder(newOrder: string[]) {
		try {
			this.data.noteOrder = newOrder;
			await this.savePluginData();
		} catch (error) {
			console.error('Error updating note order:', error);
		}
	}

	async ensureMiniNotesFolder() {
		try {
			if (!this.data.autoCreateFolder) {
				return;
			}

			const folderPath = normalizePath(this.data.autoCreateFolderPath);
			const folder = this.app.vault.getAbstractFileByPath(folderPath);

			if (!folder) {
				await this.app.vault.createFolder(folderPath);
				new Notice(`Folder "${folderPath}" created`);
			}
		} catch (error) {
			console.error('Error creating folder:', error);
		}
	}

	async createMiniNote() {
		try {
			let folderPath: string;

			// Determine which folder to use
			if (this.data.useObsidianDefault) {
				// Use Obsidian's default folder setting
				// @ts-expect-error: accessing internal Obsidian API
				const defaultFolder = this.app.vault.getConfig('newFileLocation') as string;

				// @ts-expect-error: accessing internal Obsidian API
				const specifiedFolder = this.app.vault.getConfig('newFileFolderPath') as string;

				if (defaultFolder === 'folder' && specifiedFolder) {
					folderPath = normalizePath(specifiedFolder);
				} else if (defaultFolder === 'current') {
					// Use currently active file's folder
					const activeFile = this.app.workspace.getActiveFile();
					if (activeFile) {
						folderPath = activeFile.parent?.path || '/';
					} else {
						folderPath = '/';
					}
				} else {
					// Default to root
					folderPath = '/';
				}
			} else {
				// Use plugin's custom folder setting
				folderPath = normalizePath(this.data.newNotesFolder);
			}

			// Ensure folder exists (skip if root folder)
			if (folderPath !== '/' && !this.app.vault.getAbstractFileByPath(folderPath)) {
				await this.app.vault.createFolder(folderPath);
			}

			// Generate filename with date only
			const now = new Date();
			const date = now.toLocaleDateString('en-CA'); // YYYY-MM-DD format

			// Find available filename
			let fileName = `${date}.md`;
			let filePath = folderPath === '/' ? normalizePath(fileName) : normalizePath(`${folderPath}/${fileName}`);
			let counter = 1;

			while (this.app.vault.getAbstractFileByPath(filePath)) {
				fileName = `${date} (${counter}).md`;
				filePath = folderPath === '/' ? normalizePath(fileName) : normalizePath(`${folderPath}/${fileName}`);
				counter++;
			}

			// Create empty file
			const content = '';
			const file = await this.app.vault.create(filePath, content);

			// Open the file in a new leaf
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(file);

			new Notice('New mini note created');
		} catch (error) {
			console.error('Error creating mini note:', error);
			new Notice('Failed to create mini note');
		}
	}

	async createQuickNote(title: string, content: string) {
		try {
			let folderPath: string;

			// Determine which folder to use
			if (this.data.useObsidianDefault) {
				// Use Obsidian's default folder setting
				// @ts-expect-error: accessing internal Obsidian API
				const defaultFolder = this.app.vault.getConfig('newFileLocation') as string;

				// @ts-expect-error: accessing internal Obsidian API
				const specifiedFolder = this.app.vault.getConfig('newFileFolderPath') as string;

				if (defaultFolder === 'folder' && specifiedFolder) {
					folderPath = normalizePath(specifiedFolder);
				} else if (defaultFolder === 'current') {
					// Use currently active file's folder
					const activeFile = this.app.workspace.getActiveFile();
					if (activeFile) {
						folderPath = activeFile.parent?.path || '/';
					} else {
						folderPath = '/';
					}
				} else {
					// Default to root
					folderPath = '/';
				}
			} else {
				// Use plugin's custom folder setting
				folderPath = normalizePath(this.data.newNotesFolder);
			}

			// Ensure folder exists (skip if root folder)
			if (folderPath !== '/' && !this.app.vault.getAbstractFileByPath(folderPath)) {
				await this.app.vault.createFolder(folderPath);
			}

			// Generate filename
			const now = new Date();
			let fileName: string;

			if (title) {
				// Use title as filename (sanitize for filesystem)
				const sanitizedTitle = title
					.replace(/[\\/:*?"<>|]/g, '-') // Replace invalid chars
					.replace(/\s+/g, ' ') // Normalize spaces
					.trim()
					.substring(0, 100); // Limit length
				fileName = `${sanitizedTitle}.md`;
			} else {
				// Use date-time as filename
				const date = now.toLocaleDateString('en-CA'); // YYYY-MM-DD format
				const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // HH:MM format
				fileName = `${date} ${time}.md`;
			}

			// Find available filename
			let filePath = folderPath === '/' ? normalizePath(fileName) : normalizePath(`${folderPath}/${fileName}`);
			let counter = 1;

			while (this.app.vault.getAbstractFileByPath(filePath)) {
				const baseName = fileName.replace('.md', '');
				fileName = `${baseName} (${counter}).md`;
				filePath = folderPath === '/' ? normalizePath(fileName) : normalizePath(`${folderPath}/${fileName}`);
				counter++;
			}

			// Create file content
			let fileContent = '';
			if (title) {
				fileContent += `# ${title}\n\n`;
			}
			if (content) {
				fileContent += content;
			}

			// Create file
			const file = await this.app.vault.create(filePath, fileContent);

			new Notice('Quick note created');

			// Open the file if setting is enabled
			if (this.data.openAfterCreate) {
				const leaf = this.app.workspace.getLeaf('tab');
				await leaf.openFile(file);
			}

			// Trigger refresh if dashboard is open
			// @ts-ignore - Custom event type
			this.app.workspace.trigger('mini-notes:settings-changed');
		} catch (error) {
			console.error('Error creating quick note:', error);
			throw error;
		}
	}

	async activateView() {
		try {
			const { workspace } = this.app;

			let leaf: WorkspaceLeaf | null = null;
			const leaves = workspace.getLeavesOfType(VIEW_TYPE_VISUAL_DASHBOARD);

			if (leaves.length > 0) {
				leaf = leaves[0]!;
			} else {
				leaf = workspace.getLeaf('tab');
				if (leaf) {
					await leaf.setViewState({
						type: VIEW_TYPE_VISUAL_DASHBOARD,
						active: true,
					});
				}
			}

			if (leaf) {
				await workspace.revealLeaf(leaf);
			}
		} catch (error) {
			console.error('Error activating view:', error);
		}
	}

	async activateSidebarView() {
		try {
			const { workspace } = this.app;

			let leaf: WorkspaceLeaf | null = null;
			const leaves = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);

			if (leaves.length > 0) {
				// If sidebar view already exists, reveal it
				leaf = leaves[0]!;
			} else {
				// Create a new sidebar leaf
				leaf = workspace.getRightLeaf(false);
				if (leaf) {
					await leaf.setViewState({
						type: VIEW_TYPE_SIDEBAR,
						active: true,
					});
				}
			}

			if (leaf) {
				await workspace.revealLeaf(leaf);
			}
		} catch (error) {
			console.error('Error activating sidebar view:', error);
		}
	}

	async handleFileRename(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile)) return;

		const newPath = file.path;
		let dataChanged = false;

		// Update noteColors
		if (this.data.noteColors[oldPath]) {
			this.data.noteColors[newPath] = this.data.noteColors[oldPath];
			delete this.data.noteColors[oldPath];
			dataChanged = true;
		}

		// Update pinnedNotes
		const pinnedIndex = this.data.pinnedNotes.indexOf(oldPath);
		if (pinnedIndex > -1) {
			this.data.pinnedNotes[pinnedIndex] = newPath;
			dataChanged = true;
		}

		// Update noteOrder
		const orderIndex = this.data.noteOrder.indexOf(oldPath);
		if (orderIndex > -1) {
			this.data.noteOrder[orderIndex] = newPath;
			dataChanged = true;
		}

		if (dataChanged) {
			await this.savePluginData();
			// Trigger view refresh
			this.app.workspace.trigger('mini-notes:settings-changed');
		}
	}

	async handleFileDelete(file: TAbstractFile) {
		if (!(file instanceof TFile)) return;

		const filePath = file.path;
		let dataChanged = false;

		// Remove from noteColors
		if (this.data.noteColors[filePath]) {
			delete this.data.noteColors[filePath];
			dataChanged = true;
		}

		// Remove from pinnedNotes
		const pinnedIndex = this.data.pinnedNotes.indexOf(filePath);
		if (pinnedIndex > -1) {
			this.data.pinnedNotes.splice(pinnedIndex, 1);
			dataChanged = true;
		}

		// Remove from noteOrder
		const orderIndex = this.data.noteOrder.indexOf(filePath);
		if (orderIndex > -1) {
			this.data.noteOrder.splice(orderIndex, 1);
			dataChanged = true;
		}

		if (dataChanged) {
			await this.savePluginData();
		}
	}

	onunload() {
		// Don't detach leaves - let user's layout persist
	}
}
