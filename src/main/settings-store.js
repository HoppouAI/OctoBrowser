/**
 * Settings Store - Persists user settings
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
const defaultSettings = {
    theme: 'system',
    sidebarWidth: 380,
    sidebarVisible: true,
    homepage: 'https://github.com',
    searchEngine: 'google',
};
export class SettingsStore {
    settings;
    filePath;
    constructor() {
        const userDataPath = app.getPath('userData');
        this.filePath = path.join(userDataPath, 'settings.json');
        this.settings = this.loadSettings();
    }
    loadSettings() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                return { ...defaultSettings, ...JSON.parse(data) };
            }
        }
        catch (error) {
            console.error('Failed to load settings:', error);
        }
        return { ...defaultSettings };
    }
    saveSettings() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
        }
        catch (error) {
            console.error('Failed to save settings:', error);
        }
    }
    get(key) {
        return this.settings[key];
    }
    set(key, value) {
        this.settings[key] = value;
        this.saveSettings();
    }
    getAll() {
        return { ...this.settings };
    }
    reset() {
        this.settings = { ...defaultSettings };
        this.saveSettings();
    }
}
