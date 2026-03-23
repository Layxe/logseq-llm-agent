import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin.user"
import { ConfigurableComponent } from "./ConfigurableComponent"

export interface PluginSettingsEntity {
    apiBaseUrl: string,
    apiKey: string,
    model: string,
    maxContentSize: number,
    contextSize: number
}

export const settingsConfig: SettingSchemaDesc[] = [
    {
        key: "apiBaseUrl",
        title: "API Base URL",
        description: "The base URL for the API endpoint",
        type: "string",
        default: ""
    },
    {
        key: "apiKey",
        title: "API Key",
        description: "The API key for authentication",
        type: "string",
        default: ""

    },
    {
        key: "model",
        title: "Model",
        description: "Model to use for the prompts, f.e. gpt-oss:120b",
        type: "string",
        default: "gpt-oss:120b"

    },
    {
        key: "maxContentSize",
        title: "Page Maximum Content Size",
        description: "The maximum number of characters to process when fetching page content. Set to -1 for no limit.",
        type: "number",
        default: -1
    },
    {
        key: "contextSize",
        title: "Context Size",
        description: "The size of the context window for the LLM. Set to -1 to inherit the default value from OLLAMA.",
        type: "number",
        default: -1
    }
]

export class PluginSettings {
    private static _instance: PluginSettings
    private _configurableComponents: ConfigurableComponent[] = []
    private _settings: PluginSettingsEntity = null!

    private constructor() {
        logseq.useSettingsSchema(settingsConfig)
        this.updateSettings(logseq.settings)

        logseq.onSettingsChanged(() => {
            if (logseq.settings) {
                this.updateSettings(logseq.settings)
            }
        })
    }

    /**
     * Get the singleton instance of the plugin settings.
     * @returns PluginSettings instance
     */
    public static getInstance(): PluginSettings {
        if (!PluginSettings._instance) {
            PluginSettings._instance = new PluginSettings();
        }
        return PluginSettings._instance;
    }

    /**
      * Register a new configurable component that should be updated with new settings.
      * @param component Configurable component that should be registered.
      */
     public static registerConfigurableComponent(component: ConfigurableComponent) {
        this.getInstance()._configurableComponents.push(component)
     }

     /**
      * Get the current settings for the plugin.
      * @returns The current settings for the plugin.
      */
     public static getSettings(): PluginSettingsEntity {
        return this.getInstance()._settings
     }

     /**
      * Update the settings for each configurable component.
      * @param settings New settings for the plugin.
      */
     private updateSettings(settings: any) {
        this._settings = settings

        this._configurableComponents.forEach(component => {
            component.configure(this._settings)
        })
     }
}