import {
    App,
    Plugin,
    PluginSettingTab,
    Setting,
    Notice,
    Modal,
    moment,
    normalizePath,
    requestUrl
} from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './setting';

export default class DailyDigestPlugin extends Plugin {
    settings: PluginSettings;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new DailyDigestSettingTab(this.app, this));

        this.addCommand({
            id: 'generate-daily-report',
            name: 'Generate daily report',
            callback: () => this.generateDailyReport(0)
        });

        this.addCommand({
            id: 'generate-previous-day-report',
            name: 'Generate previous day report',
            callback: () => {
                const modal = new DaysSelectionModal(this.app, async (days: number) => {
                    if (days > 0) days = -days;
                    await this.generateDailyReport(days);
                });
                modal.open();
            }
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async generateDailyReport(daysOffset: number = 0) {
        try {
            const targetDate = moment().add(daysOffset, 'days');
            const dateStr = targetDate.format('YYYY-MM-DD');

            const files = this.app.vault.getMarkdownFiles();
            const todayNotes = files.filter(file => {
                const fileCreateDate = moment(file.stat.ctime).format('YYYY-MM-DD');
                const fileModifyDate = moment(file.stat.mtime).format('YYYY-MM-DD');
                return fileCreateDate === dateStr || fileModifyDate === dateStr;
            });
            new Notice(`Found ${todayNotes.length} notes`);

            if (todayNotes.length === 0) {
                new Notice(`No notes found for ${dateStr}`);
                return;
            }

            const prompt = await this.generatePrompt(todayNotes);

            const summary = await this.callLLM(prompt);

            if (!summary) {
                new Notice('Failed to generate summary');
                return;
            }

            await this.createDailyReport(dateStr, summary);
            new Notice('Daily report generated successfully!');

        } catch (error) {
            await this.logError(error, 'Fail to generate report');
            console.error('Error generating daily report:', error);
            new Notice(`Error: ${error.message}`);
        }
    }

    async getTodayNotes() {
        try {
            const files = this.app.vault.getMarkdownFiles();
            const today = moment().format('YYYY-MM-DD');


            const todayNotes = files.filter(file => {
                const fileNameDate = this.getDateFromFileName(file.name);
                if (fileNameDate === today) return true;

                const fileCreateDate = moment(file.stat.ctime).format('YYYY-MM-DD');
                const fileModifyDate = moment(file.stat.mtime).format('YYYY-MM-DD');
                return fileCreateDate === today || fileModifyDate === today;
            });

            return todayNotes;

        } catch (error) {
            throw error;
        }
    }

    async callLLM(prompt: string) {
        try {

            const response = await requestUrl({
                url: this.settings.apiEndpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.7
                })
            });


            if (response.status !== 200) {
                throw new Error(`API request failed: ${response.status}`);
            }

            return response.json.choices?.[0]?.message?.content || '';

        } catch (error) {
            await this.logError(error, 'Fail to call LLM API');
            throw new Error(`Fail to call LLM API: ${error.message}`);
        }
    }

    async createDailyReport(date: string, content: string) {
        try {
            const fileName = normalizePath(`${this.settings.reportLocation}/Daily Report-${date}.md`);

            if (await this.app.vault.adapter.exists(fileName)) {
                const existingContent = await this.app.vault.adapter.read(fileName);
                const newContent = `${existingContent}\n\n## updated at ${new Date().toLocaleTimeString()}\n\n${content}`;
                await this.app.vault.adapter.write(fileName, newContent);
            } else {
                const fileContent = `# ${date} report\n\n${content}`;
                await this.app.vault.create(fileName, fileContent);
            }

        } catch (error) {
            console.error('Fail to create/update report file:', error);
            throw new Error(`Fail to create/update file: ${error.message}`);
        }
    }

    private getDateFromFileName(fileName: string): string {
        const match = fileName.match(/(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : '';
    }

    private async generatePrompt(notes: any[]): Promise<string> {
        try {
            const notesContents = await Promise.all(
                notes.map(async note => {
                    const content = await this.app.vault.read(note);
                    return `${note.name}:\n${content}`;
                })
            );

            const allContent = notesContents.join('\n\n');

            return `Please summarize the main content of today's notes:\n\n${allContent}`;
        } catch (error) {
            console.error('Fail to generate prompt:', error);
            throw new Error(`Fail to generate prompt: ${error.message}`);
        }
    }

    private async logError(error: any, context: string) {
        try {
            const time = new Date().toISOString();
            const errorLog = `
[${time}] ${context}
Error message: ${error.message}
Stack trace: ${error.stack}
API configuration: 
- endpoint: ${this.settings.apiEndpoint || 'Not set'}
- apiKey: ${this.settings.apiKey ? 'Set' : 'Not set'}
-------------------
`;
            const logFile = `${this.settings.reportLocation}/debug-errors.md`;

            let content = errorLog;
            if (await this.app.vault.adapter.exists(logFile)) {
                const existingContent = await this.app.vault.adapter.read(logFile);
                content = existingContent + '\n' + errorLog;
            }

            await this.app.vault.adapter.write(logFile, content);
        } catch (logError) {
            console.error('Fail to write error log:', logError);
        }
    }
}

class DailyDigestSettingTab extends PluginSettingTab {
    plugin: DailyDigestPlugin;

    constructor(app: App, plugin: DailyDigestPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('API key')
            .setDesc('Enter your LLM API key')
            .addText(text => text
                .setPlaceholder('Enter API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('API endpoint')
            .setDesc('Enter API endpoint address')
            .addText(text => text
                .setPlaceholder('https://api.example.com/v1/chat')
                .setValue(this.plugin.settings.apiEndpoint)
                .onChange(async (value) => {
                    this.plugin.settings.apiEndpoint = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Report save location')
            .setDesc('Set the folder path to save the report (e.g., /Reports or /Daily)')
            .addText(text => text
                .setPlaceholder('/')
                .setValue(this.plugin.settings.reportLocation)
                .onChange(async (value) => {
                    this.plugin.settings.reportLocation = value;
                    await this.plugin.saveSettings();
                }));
    }
}

class DaysSelectionModal extends Modal {
    private daysCallback: (days: number) => void;

    constructor(app: App, callback: (days: number) => void) {
        super(app);
        this.daysCallback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: 'Select the number of days to generate the report' });

        const inputEl = contentEl.createEl('input', {
            type: 'number',
            value: '1',
            attr: {
                min: '1',
                max: '30'
            }
        });

        const buttonEl = contentEl.createEl('button', {
            text: 'Confirm'
        });

        buttonEl.onclick = () => {
            const days = parseInt(inputEl.value);
            if (!isNaN(days) && days > 0) {
                this.daysCallback(days);
                this.close();
            }
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}