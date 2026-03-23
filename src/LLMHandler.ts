import "@logseq/libs"
import { Ollama } from 'ollama'
import { ConfigurableComponent } from "./ConfigurableComponent";
import axios from "axios";
import { ToolName, logseqAvailableFunctions, logseqTools } from "./LLMTools";
import { PluginSettingsEntity } from "./PluginSettings";
import { UserInterface } from "./UserInterface";
import { BlockEntity } from "@logseq/libs/dist/LSPlugin.user";

const LLM_SETTINGS_PAGE = ".llm"
export const SYSTEM_PROMPT =
`You are a helpful AI assistant for the Logseq knowledge base. You must only respond in valid markdown format. Do NOT wrap your responses in backticks. Do NOT comment on your responses. Return clear and concise responses. The markdown syntax for logseq outputs looks like this:

- #### Task list
    - TODO write documentation
    - DOING writing documentation
    - DONE review PR
- #### Block reference and embed
    - {{embed ((block-id))}} → shows the content of the referenced block.
- #### Page links and tags
    - [[Home page]]
      #project
- #### Properties
    - Business Review
      properties:: Property 1, Property 2
      author::  Jane Doe
      created:: [[2026-03-22]]
- #### Tasks examples
    - TODO Example task
      DEADLINE: <2026-03-31 Tue>
    - TODO Example task 2
      SCHEDULED: <2026-04-02 Thu>
- #### Table example
    - | Feature      | Supported | Notes                     |
      |--------------|:---------:|---------------------------|
      | Bold         | ✅        | xxx                       |
      | Task list    | ✅        | xxx                       |
- #### Query example
    - {{query (and [[DOING]] (not #done))}} - lists all open DOING items that are not tagged #done.
      collapsed:: true
- Logseq structures content in blocks
    - Every block corresponds to an entry in an unordered list
    - Markdown is fully supported
      as well as line breaks in the same block
`


export class LLMHandler extends ConfigurableComponent {
    static _instance: LLMHandler
    apiBaseUrl: string = ""
    apiKey: string = ""
    model: string = ""
    ollama: Ollama | null = null
    systemPrompt: string = SYSTEM_PROMPT
    maximumCharacterPageFetching = 8192
    contextSize = 2048

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
        this.maximumCharacterPageFetching = settings.maxContentSize;
        this.contextSize = settings.contextSize;

        this.ollama = new Ollama({
            host: this.apiBaseUrl,
            headers: { Authorization: 'Bearer ' + this.apiKey },
        })

        let llmHandlerInstance = this;

        setTimeout(async () => {
            const page = await logseq.Editor.getPage(LLM_SETTINGS_PAGE)

            if (!page) {
                console.info("LLM settings page '" + LLM_SETTINGS_PAGE + "' not found.")
                return
            }

            const pageBlocks = await logseq.Editor.getPageBlocksTree(page.uuid)

            let systemPromptFound = false
            // Commands have the shape: Command: `<cmd name>`
            const customCommandDeclarationRegex = /^Command: `(.+)`$/

            for (const block of pageBlocks!) {
                const blockContent = block.content

                if (blockContent?.startsWith("```") && !systemPromptFound) {
                    const newPrompt = blockContent.replaceAll("```", "")
                    llmHandlerInstance.systemPrompt = newPrompt
                    systemPromptFound = true
                }

                const customCommandMatch = blockContent?.match(customCommandDeclarationRegex)
                if (customCommandMatch) {
                    const [, command] = customCommandMatch
                    const blockObj = await logseq.Editor.getBlock(block.uuid)

                    if (!blockObj) {
                        continue
                    }

                    let child = blockObj.children?.[0] as BlockEntity

                    if (child) {
                        const child_uuid = child[1] as string
                        const childBlock = await logseq.Editor.getBlock(child_uuid)
                        let childContent = childBlock?.content

                        if (childContent) {

                            // remove ``` from the start and end of the content
                            childContent = childContent.replace(/^```/, "").replace(/```$/, "")

                            console.log(`Found custom prompt for command '${command}': ${childContent}`)

                            UserInterface.getInstance().addCustomPresetPrompt(command, childContent)
                        }
                    }
                }
            }
        }, 2000)

        console.log("Configured LLM Handler! Using host " + this.apiBaseUrl)
    }

    async runAgent(userInput: string) {
        if (this.ollama == null) {
            console.error("LLM Handler not configured.")
            return
        }

        const infoElement = document.getElementById("llm-info")

        if (infoElement) {
            infoElement.innerHTML = "Calling LLM..."
        }

        const MAX_CALLS = 30
        let calls = 0

        const messages = [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: userInput }
        ]

        const contextSizeInteger = parseInt(String(this.contextSize))

        const options: any = {}

        if (contextSizeInteger > 0) {
            options.num_ctx = contextSizeInteger
        }

        while (true && calls < MAX_CALLS) {
            const response = await this.ollama.chat({
                model: this.model,
                messages: messages,
                tools: logseqTools,
                think: true,
                keep_alive: "15m",
                options: options
            })

            messages.push(response.message)

            const toolCalls = response.message.tool_calls ?? []

            if (toolCalls.length) {
                for (const call of toolCalls) {
                    const toolName = call.function.name as ToolName
                    const fn = logseqAvailableFunctions[toolName]
                    if (!fn) {
                        continue
                    }

                    let result: string | number = ""
                    console.log(`Calling ${toolName} with arguments`, call.function.arguments)

                    if (infoElement) {
                        infoElement.innerHTML = `Calling ${toolName}(${JSON.stringify(call.function.arguments)})...`
                    }

                    if (toolName === 'fetchUrl') {
                        const args = call.function.arguments as { url: string }
                        result = await fn(args.url)
                    }

                    if (toolName === 'getLogseqPageContent') {
                        const args = call.function.arguments as { pageName: string }
                        result = await fn(args.pageName)
                    }

                    if (toolName === 'getLogseqBlocksWithReference') {
                        const args = call.function.arguments as { pageReference: string }
                        result = await fn(args.pageReference)
                    }

                    if (toolName === 'getRecentlyEditedPages') {
                        result = await fn()
                    }

                    if (toolName === 'getBlockContentByUUID') {
                        const args = call.function.arguments as { uuid: string }
                        result = await fn(args.uuid)
                    }

                    messages.push({ role: 'tool', tool_name: toolName, content: String(result) })
                }
            } else {
                break;
            }
            calls++;
        }

        if (infoElement) {
            infoElement.innerHTML = ""
        }

        console.log("Exchanged messages:")
        console.log(messages)

        return messages[messages.length - 1];
    }

    /**
     * Send a mesage to the OLLAMA API
     * @param message Message to send.
     * @param systemPrompt System prompt to include.
     * @param outputFormat Desired output format.
     */
    async sendMessage(message: string, SYSTEM_PROMPT: string = "", outputFormat: string | null = null): Promise<any> {
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

        const requestOptions = {
            model: this.model.trim(),
            prompt: message,
            stream: false,
            system: SYSTEM_PROMPT,
        }

        try {
            const response = await axios.post(
                `${baseUrl}/api/generate`,
                requestOptions,
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