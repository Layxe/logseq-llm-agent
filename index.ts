import '@logseq/libs';
import { PageEntity } from "@logseq/libs/dist/LSPlugin.user";
import { PluginSettings } from './src/PluginSettings';
import { CommandsHandler } from './src/Commands';
import { LLMHandler } from './src/LLMHandler';

// Functions
// #################################################################################################

async function main () {
    console.log("[Logseq LLM Agent] Plugin initialized.")

    PluginSettings.getInstance()
    const commandsHandler = new CommandsHandler()

    commandsHandler.registerCommands()

    PluginSettings.registerConfigurableComponent(commandsHandler)
    PluginSettings.registerConfigurableComponent(LLMHandler.getInstance())
}

function createModel() {
    return {
        func1 () {
            console.log("Hello, World!")
        }
    }
}

logseq.ready(createModel()).then(main).catch(console.error)