import "@logseq/libs"
import axios from "axios";
import Fuse from "fuse.js";
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { LogseqUtil } from "./LogseqUtil";
import { PageEntity } from "@logseq/libs/dist/LSPlugin";

export type ToolName = 'fetchUrl' | 'getLogseqPageContent' | 'getLogseqBlocksWithReference' | 'getRecentlyEditedPages' | 'getBlockContentByUUID'

type ToolFunctionMap = {
    fetchUrl: (url: string) => Promise<string>
    getLogseqPageContent: (pageName: string) => Promise<string>,
    getLogseqBlocksWithReference: (pageReference: string) => Promise<string>
    getRecentlyEditedPages: () => Promise<string>
    getBlockContentByUUID: (uuid: string) => Promise<string>
}

async function getSimilarPageNames(pageName: string, maxResults = 5): Promise<string[]> {
    const pages = await logseq.Editor.getAllPages() as PageEntity[]

    if (!pages || pages.length === 0) {
        return []
    }

    const pageNames = pages
        .map((page) => page.originalName)
        .filter((name): name is string => Boolean(name))

    const exactCaseInsensitiveMatch = pageNames.find(
        (name) => name.toLowerCase() === pageName.toLowerCase()
    )

    if (exactCaseInsensitiveMatch) {
        return [exactCaseInsensitiveMatch]
    }

    const fuse = new Fuse(pageNames, {
        includeScore: true,
        threshold: 0.4,
        ignoreLocation: true,
    })

    return fuse
        .search(pageName, { limit: maxResults })
        .map((result) => result.item)
}

// Functions
// #################################################################################################

async function getBlockContentByUUID(uuid: string): Promise<string> {
    try {
        const block = await logseq.Editor.getBlock(uuid)

        if (!block) {
            return "[error] Block not found"
        }

        return await LogseqUtil.getBlockAndChildrenContentAsStr(block)
    } catch (error) {
        return "[error] Not a valid block UUID"
    }

}


async function getRecentlyEditedPages(): Promise<string> {
    // Implementation for fetching recently edited pages
    const pages = await logseq.Editor.getAllPages() as PageEntity[]

    if (!pages) {
        return "[error] Failed to retrieve pages"
    }
    const recentlyEditedPages = pages
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30)

    const slimRecentlyEditedPages = []

    for (const page of recentlyEditedPages) {
        slimRecentlyEditedPages.push({
            name: page.originalName,
            updatedAt: page.updatedAt
        })
    }

    return JSON.stringify(slimRecentlyEditedPages)
}

async function getLogseqBlocksWithReference(pageReference: string): Promise<string> {
    // Clean page reference if its in the shape of [[page-name]] or #page-name
    if (pageReference.startsWith("[[") && pageReference.endsWith("]]")) {
        pageReference = pageReference.slice(2, -2)
    } else if (pageReference.startsWith("#")) {
        pageReference = pageReference.slice(1)
    }

    pageReference = pageReference.toLowerCase()

    let output = await logseq.DB.customQuery(`
        [:find (pull ?b [*])
         :where
         [?b :block/refs ?p]
         [?p :block/name "${pageReference}"]
        ]
    `)

    const searchResults = []

    for (const result of output) {

        if (result.uuid === undefined) {
            continue
        }

        searchResults.push({
            uuid: result.uuid,
            page: result.page.originalName,
            content: result.content,
        })
    }

    if (searchResults.length === 0) {
        return `[error] No blocks found referencing the specified page "${pageReference}"`
    }


    return JSON.stringify(searchResults)
}

async function getLogseqPageContent(pageName: string) {

    console.log("Calling tool with page name:", pageName)

    // Remove [[ ... ]] if present
    if (pageName.startsWith("[[") && pageName.endsWith("]]")) {
        pageName = pageName.slice(2, -2)
    }

    let pageObj = await logseq.Editor.getPage(pageName)
    if (pageObj) {
        let pageBlocks = await logseq.Editor.getPageBlocksTree(pageObj.uuid)

        if (pageBlocks!.length === 0) {
            // No blocks, check if there is an alias
            const aliases = pageObj.alias as object[]

            if (!aliases) {
                return "[warning] Page found but no content"
            }

            const aliasPageId = aliases[0].id

            pageObj = await logseq.Editor.getPage(aliasPageId)
            pageBlocks = await logseq.Editor.getPageBlocksTree(pageObj.uuid)
            console.log(pageObj)
            console.log(pageBlocks)
        }

        let pageContentMarkdown = ""

        if (!pageBlocks) {
            return "[error] Failed to retrieve page content"
        }

        for (const block of pageBlocks) {
            pageContentMarkdown += await LogseqUtil.getBlockAndChildrenContentAsStr(block) + "\n"
        }

        return pageContentMarkdown
    } else {
        const similarPages = await getSimilarPageNames(pageName)

        if (similarPages.length === 0) {
            return "[error] Page not found"
        }

        const suggestedPages = similarPages
            .map((name) => `[[${name}]]`)
            .join(", ")

        console.log("Suggested pages:", suggestedPages)
        return `[error] Page not found. Did you mean: ${suggestedPages}?`
    }
}

async function fetchUrl(url: string): Promise<string> {
    try {
        const response = await axios.get(url);
        const markdownResponse = NodeHtmlMarkdown.translate(response.data);
        return markdownResponse;
    } catch (error) {
        console.error("Error fetching URL:", error);
        return "[error] Failed to fetch URL";
    }
}

// Tool Map
// #################################################################################################

export const logseqAvailableFunctions: ToolFunctionMap = {
  fetchUrl,
  getLogseqPageContent,
  getLogseqBlocksWithReference,
  getRecentlyEditedPages,
  getBlockContentByUUID
}

export const logseqTools = [
    {
        type: 'function',
        function: {
            name: 'fetchUrl',
            description: 'Fetch a URL. ONLY USE THIS TOOL IF AN URL IS SPECIFIED',
            parameters: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string', description: 'The URL to fetch' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'getLogseqPageContent',
            description: 'Get the content of a Logseq page',
            parameters: {
                type: 'object',
                required: ['pageName'],
                properties: {
                    pageName: { type: 'string', description: 'The name of the Logseq page' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'getLogseqBlocksWithReference',
            description: 'Get blocks that reference a specific Logseq page',
            parameters: {
                type: 'object',
                required: ['pageReference'],
                properties: {
                    pageReference: { type: 'string', description: 'The reference to the Logseq page' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'getRecentlyEditedPages',
            description: 'Get a list of recently edited pages, use this if you cannot find the correct page name',
            parameters: {
                type: 'object',
                required: [],
                properties: {},
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'getBlockContentByUUID',
            description: 'Get the content of a Logseq block by its UUID',
            parameters: {
                type: 'object',
                required: ['uuid'],
                properties: {
                    uuid: { type: 'string', description: 'The UUID of the Logseq block' },
                },
            },
        },
    }
]