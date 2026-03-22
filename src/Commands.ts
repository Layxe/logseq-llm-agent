import { ConfigurableComponent } from "./ConfigurableComponent";
import { LLMHandler } from "./LLMHandler";
import { LogseqUtil } from "./LogseqUtil";
import { PluginSettingsEntity } from "./PluginSettings";

export class CommandsHandler extends ConfigurableComponent {
    private promptInputElement: HTMLInputElement | null = null;
    private readonly presetPromptMap: Record<string, string> = {
        "/sum": "Summarize this in concise bullet points:",
        "/rewrite": "Rewrite this to be clearer and more concise:",
        "/action": "Extract action items from this:",
        "/tags": "Suggest suitable Logseq tags for this content:",
        "/ask": "Answer this clearly and briefly:"
    };

    constructor() {
        super();
    }

    configure(settings: PluginSettingsEntity): void {

    }

    showSpinner() {
        document.getElementById("spinner")!.style.display = "block";
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
            logseq.UI.showMsg("Prompt cannot be empty", "warning");
            return;
        }

        this.hideInput();
        this.showSpinner();

        try {
            const block = await logseq.Editor.getCurrentBlock();

            if (!block) {
                logseq.UI.showMsg("No block selected", "warning");
                return;
            }

            const blockContent = await LogseqUtil.getBlockAndChildrenContentAsStr(block);
            const expandedPrompt = this.expandPresetPrompt(userPrompt);
            const fullPrompt = `You are a helpful AI assistant for the Logseq knowledge base. You must only respond in valid markdown format. Do NOT wrap your responses in backticks. Do NOT comment on your responses. Return clear and concise responses.\n\nInstruction:\n${expandedPrompt}\n\nLogseq context:\n${blockContent}`;
            const msg = await LLMHandler.getInstance().sendMessage(fullPrompt);
            const response = msg?.response;

            if (!response) {
                logseq.UI.showMsg("Model returned no response", "warning");
                return;
            }

            let parsedResponse = LogseqUtil.parseMarkdownToBlocks(response)
            console.log(parsedResponse)

            await LogseqUtil.insertBlocks(block, parsedResponse)
            this.promptInputElement.value = "";
        } finally {
            this.hideSpinner();
        }
    }

    registerCommands() {
        this.initPromptInput();
        logseq.Editor.registerSlashCommand("LLM summarize page", async () => {

        })

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