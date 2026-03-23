import { ConfigurableComponent } from "./ConfigurableComponent";
import { LLMHandler } from "./LLMHandler";
import { LogseqUtil } from "./LogseqUtil";
import { PluginSettingsEntity } from "./PluginSettings";
import { SYSTEM_PROMPT } from "./LLMHandler";

export class CommandsHandler extends ConfigurableComponent {
    private promptInputElement: HTMLInputElement | null = null;
    private readonly presetPromptMap: Record<string, string> = {
        "/sum": "Summarize this in concise bullet points:",
        "/rewrite": "Rewrite this to be clearer and more concise:",
        "/action": "Extract action items from this:",
        "/tags": "Suggest suitable Logseq tags for this content:",
        "/ask": "Answer this clearly and briefly:"
    };
    private useAgent: boolean = true

    constructor() {
        super();
    }

    configure(settings: PluginSettingsEntity): void {

    }

    showSpinner() {
        document.getElementById("spinner")!.style.display = "inline";
        logseq.showMainUI({ autoFocus: false })
    }

    hideSpinner() {
        document.getElementById("spinner")!.style.display = "none";
        logseq.hideMainUI({restoreEditingCursor: true})
    }

    showInput() {
        document.getElementById("backdrop")!.style.display = "flex";
        logseq.showMainUI({ autoFocus: false })
    }

    hideInput() {
        document.getElementById("backdrop")!.style.display = "none";
        logseq.hideMainUI({restoreEditingCursor: true})
    }

    toggleUseAgent() {
        this.useAgent = !this.useAgent;
        const inputField = document.getElementById("prompt-input");
        const inputHint = document.getElementById("prompt-hint");

        if (this.useAgent) {
            inputField!.style.borderColor = "#3498db";
            inputHint!.textContent = "Agent mode enabled. (Ctrl+Shift+L to toggle)";
        } else {
            // use a nice color
            inputField!.style.borderColor = "#f39c12";
            inputHint!.textContent = "Agent mode disabled. (Ctrl+Shift+L to toggle)";
        }

    }

    private initPromptInput() {
        if (this.promptInputElement) {
            return;
        }

        this.promptInputElement = document.getElementById("prompt-input") as HTMLInputElement | null;
        const backdrop = document.getElementById("backdrop");
        const promptPanel = document.getElementById("prompt-panel");

        if (!this.promptInputElement || !backdrop || !promptPanel) {
            return;
        }

        const presetCommands = Object.keys(this.presetPromptMap);
        const AwesompleteCtor = (window as any).Awesomplete;

        if (AwesompleteCtor) {
            new AwesompleteCtor(this.promptInputElement, {
                list: presetCommands,
                minChars: 1,
                maxItems: 8,
                autoFirst: true
            });
        }

        this.promptInputElement.addEventListener("keydown", async (event) => {
            if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "l") {
                event.preventDefault();
                this.toggleUseAgent()
            }

            if (event.key === "Enter") {
                event.preventDefault();
                await this.submitPromptInput();
            }

            if (event.key === "Escape") {
                event.preventDefault();
                this.hideInput();
            }
        });

        backdrop.addEventListener("click", (event) => {
            if (event.target === backdrop) {
                this.hideInput();
            }
        });

        promptPanel.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }

    private expandPresetPrompt(rawPrompt: string): string {
        const trimmedPrompt = rawPrompt.trim();

        if (!trimmedPrompt.startsWith("/")) {
            return trimmedPrompt;
        }

        const firstSpaceIndex = trimmedPrompt.indexOf(" ");
        const commandKey = firstSpaceIndex === -1 ? trimmedPrompt : trimmedPrompt.slice(0, firstSpaceIndex);
        const remainingText = firstSpaceIndex === -1 ? "" : trimmedPrompt.slice(firstSpaceIndex + 1).trim();
        const presetPrefix = this.presetPromptMap[commandKey];

        if (!presetPrefix) {
            return trimmedPrompt;
        }

        return remainingText ? `${presetPrefix} ${remainingText}` : presetPrefix;
    }

    private async submitPromptInput() {
        if (!this.promptInputElement) {
            return;
        }

        const userPrompt = this.promptInputElement.value.trim();

        if (!userPrompt) {
            return;
        }

        this.showSpinner();

        try {
            const block = await logseq.Editor.getCurrentBlock();

            if (!block) {
                logseq.UI.showMsg("No block selected", "warning");
                return;
            }

            const blockContent = await LogseqUtil.getBlockAndChildrenContentAsStr(block);
            const expandedPrompt = this.expandPresetPrompt(userPrompt);

            let fullPrompt = `Instruction:\n${expandedPrompt}`

            if (blockContent.length > 2) {
                console.log("Block content: " + blockContent)
                fullPrompt += `\n\nLogseq context:\n${blockContent}`
            }

            let response = null

            if (this.useAgent) {
                response = await LLMHandler.getInstance().runAgent(fullPrompt);
                response = response!.content
            } else {
                const systemPrompt = LLMHandler.getInstance().systemPrompt
                response = await LLMHandler.getInstance().sendMessage(fullPrompt, systemPrompt);
                response = response.response
            }

            if (!response) {
                logseq.UI.showMsg("Model returned no response", "warning");
                return;
            }

            let parsedResponse = LogseqUtil.parseMarkdownToBlocks(response)

            await LogseqUtil.insertBlocks(block, parsedResponse)
            this.promptInputElement.value = "";
        } finally {
            this.hideSpinner();
            this.hideInput();
        }
    }

    registerCommands() {
        this.initPromptInput();
        logseq.Editor.registerSlashCommand("LLM", async () => {
            this.showInput()

            let promptInputElement = this.promptInputElement;

            if (this.promptInputElement) {
                setTimeout(() => {
                    promptInputElement!.value = "";
                    promptInputElement!.focus();
                }, 200);
            }
        })

        // Register a keyboard shortcut
        logseq.App.registerCommandShortcut("ctrl+shift+l", async () => {
            this.showInput();

            let promptInputElement = this.promptInputElement;

            if (this.promptInputElement) {
                setTimeout(() => {
                    promptInputElement!.value = "";
                    promptInputElement!.focus();
                }, 200);
            }
        }, {
            desc: "Show the LLM input prompt window.",
            label: "Show LLM Input"
        });
    }
}