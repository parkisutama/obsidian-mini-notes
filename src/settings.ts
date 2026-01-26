import { App, PluginSettingTab, Setting } from 'obsidian';
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
					// Trigger custom event to update views
					window.dispatchEvent(new CustomEvent('mini-notes:settings-changed'));
				}));

		new Setting(containerEl)
			.setName('Source folder')
			.setDesc('Folder to fetch notes from (default is "/" for all notes in vault)')
			.addDropdown(dropdown => {
				// Get all folders in vault
				const folders = this.app.vault.getAllLoadedFiles()
					.filter(file => 'children' in file && file.children !== undefined)
					.map(folder => folder.path)
					.filter(path => path !== '');
				
				dropdown.addOption('/', 'All Notes (default)');
				
				// Add other folders
				folders.forEach(folder => {
					dropdown.addOption(folder, folder);
				});
				
				dropdown.setValue(this.plugin.data.sourceFolder);
				dropdown.onChange(async (value) => {
					this.plugin.data.sourceFolder = value;
					await this.plugin.savePluginData();
					window.dispatchEvent(new CustomEvent('mini-notes:settings-changed'));
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
						// Trigger custom event to update views
						window.dispatchEvent(new CustomEvent('mini-notes:settings-changed'));
					}
				}));

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
					window.dispatchEvent(new CustomEvent('mini-notes:settings-changed'));
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
					window.dispatchEvent(new CustomEvent('mini-notes:settings-changed'));
				}));
		
		// Set initial visibility of custom color setting
		customColorSetting.settingEl.addClass('custom-color-setting');
		customColorSetting.settingEl.style.display = this.plugin.data.themeColor === 'custom' ? 'flex' : 'none';
	}
}
