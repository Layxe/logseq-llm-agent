import '@logseq/libs';
import { PageEntity } from "@logseq/libs/dist/LSPlugin.user";
import { PluginSettings } from './src/PluginSettings';
import { UserInterface } from './src/UserInterface';
import { LLMHandler } from './src/LLMHandler';
import { getLogseqPageContent } from './src/LLMTools';

// Functions
// #################################################################################################

async function main () {
    console.log("[Logseq LLM Agent] Plugin initialized.")

    PluginSettings.getInstance()

    const userInterface = UserInterface.getInstance();
    userInterface.registerCommands()

    PluginSettings.registerConfigurableComponent(userInterface)
    PluginSettings.registerConfigurableComponent(LLMHandler.getInstance())
}

function createModel() {
    return {
        func1 () {
        }
    }
}

logseq.ready(createModel()).then(main).catch(console.error)