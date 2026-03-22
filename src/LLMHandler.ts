import { ConfigurableComponent } from "./ConfigurableComponent";
import { PluginSettingsEntity } from "./PluginSettings";
import axios from "axios";

export class LLMHandler extends ConfigurableComponent {
    static _instance: LLMHandler
    apiBaseUrl: string = ""
    apiKey: string = ""
    model: string = ""

    constructor() {
        super();
    }

    static getInstance(): LLMHandler {
        if (!LLMHandler._instance) {
            LLMHandler._instance = new LLMHandler();
        }
        return LLMHandler._instance;
    }

    configure(settings: PluginSettingsEntity): void {

        let settingsBaseUrl = settings.apiBaseUrl

        // Remove unnecessary /api at the end
        if (settingsBaseUrl.endsWith("api/")) {
            settingsBaseUrl = settingsBaseUrl.slice(0, -4)
        }

        // Remove / at the end of URL
        if (settingsBaseUrl.endsWith("/")) {
            settingsBaseUrl = settingsBaseUrl.slice(0, -1)
        }

        this.apiBaseUrl = settingsBaseUrl;
        this.apiKey = settings.apiKey;
        this.model = settings.model;
    }

    /**
     * Send a mesage to the OLLAMA API
     * @param message Message to send.
     */
    async sendMessage(message: string): Promise<any> {
        const baseUrl = this.apiBaseUrl.trim().replace(/\/$/, "");

        if (!baseUrl) {
            logseq.UI.showMsg("Missing API base URL in plugin settings.", "error")
            return
        }

        if (!this.model?.trim()) {
            logseq.UI.showMsg("Missing model in plugin settings.", "error")
            return
        }

        if (!message?.trim()) {
            logseq.UI.showMsg("Message cannot be empty.", "error")
            return
        }

        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };

        if (this.apiKey?.trim()) {
            headers.Authorization = `Bearer ${this.apiKey.trim()}`;
        }

        try {
            const response = await axios.post(
                `${baseUrl}/api/generate`,
                {
                    model: this.model.trim(),
                    prompt: message,
                    stream: false
                },
                { headers }
            );

            return response.data;
        } catch (error: any) {
            const apiError = error?.response?.data;
            const status = error?.response?.status;
            const details = apiError?.error || apiError?.message || error?.message;
            logseq.UI.showMsg(`Failed to send message to OLLAMA${status ? ` (${status})` : ""}: ${details}`)
            return
        }
    }
}