import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type VisualDashboardPlugin from './main';

export class MiniNotesSettingTab extends PluginSettingTab {
	plugin: VisualDashboardPlugin;

	constructor(app: App, plugin: VisualDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('View title')
			.setDesc('Custom title for the view')
			.addText(text => text
				.setPlaceholder('Do your best today!')
				.setValue(this.plugin.data.viewTitle)
				.onChange(async (value) => {
					this.plugin.data.viewTitle = value || 'Do Your Best Today!';
					await this.plugin.savePluginData();
				})
			);

		new Setting(containerEl)
			.setName('Source folder')
			.setDesc('Folder to fetch notes from (default is "/" for all notes in vault)')
			.addDropdown(dropdown => {
				// Get all folders in vault
				const folders = this.app.vault.getAllLoadedFiles()
					.filter(file => 'children' in file && file.children !== undefined)
					.map(folder => folder.path)
					.filter(path => path !== '');

				dropdown.addOption('/', 'All notes (default)');

				// Add other folders
				folders.forEach(folder => {
					dropdown.addOption(folder, folder);
				});

				dropdown.setValue(this.plugin.data.sourceFolder);
				dropdown.onChange(async (value) => {
					this.plugin.data.sourceFolder = value;
					await this.plugin.savePluginData();
					this.app.workspace.trigger('mini-notes:settings-changed');
				});
			});

		new Setting(containerEl)
			.setName('Maximum notes')
			.setDesc('Maximum number of notes to display (more than 300 is not recommended)')
			.addText(text => text
				.setPlaceholder('150')
				.setValue(String(this.plugin.data.maxNotes))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.data.maxNotes = num;
						await this.plugin.savePluginData();
					}
				})
			);

		// New notes location settings
		containerEl.createEl('h3', { text: 'New notes location' });

		new Setting(containerEl)
			.setName('Use Obsidian default folder')
			.setDesc('Create new notes in the folder specified in Obsidian settings (Settings > Files & Links > Default location for new notes)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.data.useObsidianDefault)
				.onChange(async (value) => {
					this.plugin.data.useObsidianDefault = value;
					await this.plugin.savePluginData();
					// Show/hide custom folder setting
					const folderSetting = containerEl.querySelector('.custom-folder-setting') as HTMLElement;
					if (folderSetting) {
						folderSetting.style.display = value ? 'none' : 'flex';
					}
				})
			);

		const customFolderSetting = new Setting(containerEl)
			.setName('Custom folder for new notes')
			.setDesc('Folder where new mini notes will be created')
			.addDropdown(dropdown => {
				// Get all folders in vault
				const folders = this.app.vault.getAllLoadedFiles()
					.filter(file => 'children' in file && file.children !== undefined)
					.map(folder => folder.path);

				// Add root folder option
				dropdown.addOption('/', 'Root folder');

				// Add other folders
				folders.forEach(folder => {
					if (folder !== '') {
						dropdown.addOption(folder, folder);
					}
				});

				// Add option to create new folder
				dropdown.addOption('Mini Notes', 'Mini Notes');

				dropdown.setValue(this.plugin.data.newNotesFolder);
				dropdown.onChange(async (value) => {
					this.plugin.data.newNotesFolder = value;
					await this.plugin.savePluginData();
				});
			});

		// Set initial visibility of custom folder setting
		customFolderSetting.settingEl.addClass('custom-folder-setting');
		customFolderSetting.settingEl.style.display = this.plugin.data.useObsidianDefault ? 'none' : 'flex';

		new Setting(containerEl)
			.setName('Open note after creation')
			.setDesc('Automatically open the note in a new tab after creating it from the quick note bar')
			.addToggle(toggle => toggle
				.setValue(this.plugin.data.openAfterCreate)
				.onChange(async (value) => {
					this.plugin.data.openAfterCreate = value;
					await this.plugin.savePluginData();
				})
			);

		// Auto-create folder settings
		containerEl.createEl('h3', { text: 'Auto-create folder' });

		new Setting(containerEl)
			.setName('Auto-create folder on startup')
			.setDesc('Automatically create a folder when the plugin loads if it doesn\'t exist')
			.addToggle(toggle => toggle
				.setValue(this.plugin.data.autoCreateFolder)
				.onChange(async (value) => {
					this.plugin.data.autoCreateFolder = value;
					await this.plugin.savePluginData();
					// Show/hide folder path setting
					const pathSetting = containerEl.querySelector('.auto-create-folder-path-setting') as HTMLElement;
					if (pathSetting) {
						pathSetting.style.display = value ? 'flex' : 'none';
					}
				})
			);

		const folderPathSetting = new Setting(containerEl)
			.setName('Folder name and path')
			.setDesc('The folder to create automatically (e.g., "Mini Notes" or "Notes/Mini Notes")')
			.addText(text => text
				.setPlaceholder('Mini Notes')
				.setValue(this.plugin.data.autoCreateFolderPath)
				.onChange(async (value) => {
					this.plugin.data.autoCreateFolderPath = value || 'Mini Notes';
					await this.plugin.savePluginData();
				})
			);

		// Set initial visibility of folder path setting
		folderPathSetting.settingEl.addClass('auto-create-folder-path-setting');
		folderPathSetting.settingEl.style.display = this.plugin.data.autoCreateFolder ? 'flex' : 'none';

		// Excluded folders settings
		containerEl.createEl('h3', { text: 'Folder exclusions' });

		new Setting(containerEl)
			.setName('Excluded folders')
			.setDesc('Notes in these folders will not appear in the mini notes view');

		// Create container for excluded folder list
		const excludedListContainer = containerEl.createDiv({ cls: 'excluded-folders-list' });

		// Function to render the list
		const renderExcludedList = () => {
			excludedListContainer.empty();

			if (this.plugin.data.excludedFolders.length === 0) {
				excludedListContainer.createDiv({
					text: 'No folders excluded',
					cls: 'setting-item-description'
				});
			} else {
				this.plugin.data.excludedFolders.forEach((folder, index) => {
					const itemEl = excludedListContainer.createDiv({ cls: 'excluded-folder-item' });
					itemEl.createSpan({ text: folder });

					const removeBtn = itemEl.createEl('button', { text: '×', cls: 'excluded-folder-remove' });
					removeBtn.addEventListener('click', async () => {
						this.plugin.data.excludedFolders.splice(index, 1);
						await this.plugin.savePluginData();
						this.app.workspace.trigger('mini-notes:settings-changed');
						renderExcludedList();
					});
				});
			}
		};

		renderExcludedList();

		// Add folder button
		new Setting(containerEl)
			.setName('Add folder to exclude')
			.addDropdown(dropdown => {
				// Get all folders in vault
				const folders = this.app.vault.getAllLoadedFiles()
					.filter(file => 'children' in file && file.children !== undefined)
					.map(folder => folder.path)
					.filter(path => path !== '' && !this.plugin.data.excludedFolders.includes(path));

				dropdown.addOption('', 'Select a folder...');

				folders.forEach(folder => {
					dropdown.addOption(folder, folder);
				});

				dropdown.setValue('');
				dropdown.onChange(async (value) => {
					if (value && !this.plugin.data.excludedFolders.includes(value)) {
						this.plugin.data.excludedFolders.push(value);
						await this.plugin.savePluginData();
						this.app.workspace.trigger('mini-notes:settings-changed');
						renderExcludedList();
						// Reset dropdown
						dropdown.setValue('');
						// Refresh dropdown options
						this.display();
					}
				});
			});

		// Allowed extensions settings
		containerEl.createEl('h3', { text: 'File extensions' });

		new Setting(containerEl)
			.setName('Allowed file extensions')
			.setDesc('Only files with these extensions will appear in the mini notes view (without the dot, e.g., "md", "txt", "canvas")');

		// Create container for extensions list
		const extensionsListContainer = containerEl.createDiv({ cls: 'allowed-extensions-list' });

		// Function to render the list
		const renderExtensionsList = () => {
			extensionsListContainer.empty();

			if (this.plugin.data.allowedExtensions.length === 0) {
				extensionsListContainer.createDiv({
					text: 'No extensions configured (no files will be shown)',
					cls: 'setting-item-description'
				});
			} else {
				this.plugin.data.allowedExtensions.forEach((ext, index) => {
					const itemEl = extensionsListContainer.createDiv({ cls: 'extension-item' });
					itemEl.createSpan({ text: `.${ext}` });

					const removeBtn = itemEl.createEl('button', { text: '×', cls: 'extension-remove' });
					removeBtn.addEventListener('click', async () => {
						this.plugin.data.allowedExtensions.splice(index, 1);
						await this.plugin.savePluginData();
						this.app.workspace.trigger('mini-notes:settings-changed');
						renderExtensionsList();
					});
				});
			}
		};

		renderExtensionsList();

		// Add extension input
		new Setting(containerEl)
			.setName('Add file extension')
			.setDesc('Enter extension without the dot (e.g., "md", "txt", "canvas")')
			.addText(text => {
				text.setPlaceholder('txt');
				text.inputEl.addEventListener('keydown', async (e: KeyboardEvent) => {
					if (e.key === 'Enter') {
						const value = text.getValue().trim().toLowerCase().replace(/^\.+/, '');
						if (value && !this.plugin.data.allowedExtensions.includes(value)) {
							this.plugin.data.allowedExtensions.push(value);
							await this.plugin.savePluginData();
							this.app.workspace.trigger('mini-notes:settings-changed');
							renderExtensionsList();
							text.setValue('');
						}
					}
				});
				return text;
			})
			.addButton(button => button
				.setButtonText('Add')
				.onClick(async () => {
					const textComponent = button.buttonEl.parentElement?.querySelector('input');
					if (textComponent) {
						const value = textComponent.value.trim().toLowerCase().replace(/^\.+/, '');
						if (value && !this.plugin.data.allowedExtensions.includes(value)) {
							this.plugin.data.allowedExtensions.push(value);
							await this.plugin.savePluginData();
							this.app.workspace.trigger('mini-notes:settings-changed');
							renderExtensionsList();
							textComponent.value = '';
						}
					}
				})
			);

		new Setting(containerEl)
			.setName('Theme color')
			.setDesc('Color for borders, pins, and accents')
			.addDropdown(dropdown => {
				dropdown.addOption('obsidian', 'Use Obsidian theme');
				dropdown.addOption('black', 'Black');
				dropdown.addOption('custom', 'Custom color');
				dropdown.setValue(this.plugin.data.themeColor);
				dropdown.onChange(async (value) => {
					this.plugin.data.themeColor = value as 'obsidian' | 'black' | 'custom';
					await this.plugin.savePluginData();
					this.app.workspace.trigger('mini-notes:settings-changed');
					// Show/hide custom color picker
					const colorSetting = containerEl.querySelector('.custom-color-setting') as HTMLElement;
					if (colorSetting) {
						colorSetting.style.display = value === 'custom' ? 'flex' : 'none';
					}
				});
			});

		const customColorSetting = new Setting(containerEl)
			.setName('Custom theme color')
			.setDesc('Choose a custom color for borders, pins, and accents')
			.addColorPicker(colorPicker => colorPicker
				.setValue(this.plugin.data.customThemeColor)
				.onChange(async (value) => {
					this.plugin.data.customThemeColor = value;
					await this.plugin.savePluginData();
					this.app.workspace.trigger('mini-notes:settings-changed');
				}));

		// Set initial visibility of custom color setting
		customColorSetting.settingEl.addClass('custom-color-setting');
		customColorSetting.settingEl.style.display = this.plugin.data.themeColor === 'custom' ? 'flex' : 'none';

		// Footer with GitHub link
		const footer = containerEl.createDiv();
		// Required for proper footer spacing and layout - CSS classes not available for settings footer
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footer.style.borderTop = 'none';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footer.style.paddingTop = '1em';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footer.style.background = 'none';

		const footerContent = footer.createDiv();
		// Required for proper footer content layout - CSS classes not available for settings footer
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.display = 'flex';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.alignItems = 'center';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.gap = '0.5em';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.fontSize = '0.7em';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		footerContent.style.color = 'var(--text-muted)';

		footerContent.createSpan({ text: 'Built by ' });

		const link = footerContent.createEl('a', {
			text: 'Rknastenka.com',
			href: 'https://rknastenka.com'
		});
		// Required to match footer text color - CSS classes not available for settings footer links
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		link.style.color = 'var(--text-muted)';
		link.setAttribute('target', '_blank');

		const githubIcon = footerContent.createSpan();
		// Required for proper icon display and interaction - CSS classes not available for settings footer icons
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		githubIcon.style.display = 'flex';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		githubIcon.style.cursor = 'pointer';
		// eslint-disable-next-line obsidianmd/no-static-styles-assignment
		githubIcon.style.marginLeft = '0.5em';
		setIcon(githubIcon, 'github');
		githubIcon.addEventListener('click', () => {
			window.open('https://github.com/rknastenka/mini-notes', '_blank');
		});
	}

	hide(): void {
		// Trigger refresh when settings are closed
		this.app.workspace.trigger('mini-notes:settings-changed');
	}
}
