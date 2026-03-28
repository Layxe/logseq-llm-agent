import "@logseq/libs"
import axios from "axios";
import Fuse from "fuse.js";
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { LogseqUtil } from "./LogseqUtil";
import { PageEntity } from "@logseq/libs/dist/LSPlugin";
import { LLMHandler } from "./LLMHandler";
import { PDFParse } from "pdf-parse";
import "pdfjs-dist/build/pdf.worker.mjs"

export type ToolName = 'fetchUrl' | 'getLogseqPageContent' | 'getLogseqBlocksWithReference' | 'getRecentlyEditedPages' | 'getBlockContentByUUID' | 'searchWeb'

type ToolFunctionMap = {
    fetchUrl: (url: string) => Promise<string>
    getLogseqPageContent: (pageName: string) => Promise<string>,
    getLogseqBlocksWithReference: (pageReference: string) => Promise<string>
    getRecentlyEditedPages: () => Promise<string>
    getBlockContentByUUID: (uuid: string) => Promise<string>
    searchWeb: (query: string) => Promise<string>
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

export async function getLogseqPageContent(pageName: string) {

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
        }

        let pageContentMarkdown = ""

        if (!pageBlocks) {
            return "[error] Failed to retrieve page content"
        }

        for (const block of pageBlocks) {
            // The PageBlocksTree only returns a list without the connected children
            // so we need to fetch the actual block.
            const actualBlock = await logseq.Editor.getBlock(block.uuid)

            if (!actualBlock) {
                continue;
            }

            pageContentMarkdown += await LogseqUtil.getBlockAndChildrenContentAsStr(actualBlock) + "\n"
        }

        const maxCharsPageFetch = LLMHandler.getInstance().maximumCharacterPageFetching

        if (maxCharsPageFetch > 0 && pageContentMarkdown.length > maxCharsPageFetch) {
            pageContentMarkdown = pageContentMarkdown.substring(0, maxCharsPageFetch)
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

type SearchResult = {
    title: string;
    url: string;
    snippet: string;
    source?: string;
    content?: string;
};

async function searchWeb(
    query: string,
): Promise<string> {
    const limit = 5

    const searxngURL = LLMHandler.getInstance().getSearxngURL()

    if (searxngURL.length === 0) {
        console.warn("SearXNG URL is not configured.");
        return "[error] SearXNG URL is not configured. ABORT ANY FURTHER WEB SEARCH"
    }

    try {
        // 1. Search via SearXNG
        const response = await axios.get(
            searxngURL,
            {
                params: {
                    q: query,
                    format: "json",
                    language: "en",
                    safesearch: 0
                }
            }
        );

        let results: SearchResult[] = (response.data.results || []).map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.content || "",
            source: r.engine
        }));

        results = results.filter(r => r.url && r.title);

        const seenDomains = new Set<string>();
        results = results.filter(r => {
            try {
                const domain = new URL(r.url).hostname;
                if (seenDomains.has(domain)) return false;
                seenDomains.add(domain);
                return true;
            } catch {
                return false;
            }
        });

        function score(r: SearchResult): number {
            let s = 0;
            if (r.url.endsWith(".pdf")) s += 2;
            if (r.source === "google") s += 1;
            if (r.snippet.length > 120) s += 1;
            return s;
        }

        results.sort((a, b) => score(b) - score(a));

        // 5. Limit results
        results = results.slice(0, limit);

        // 6. Format results into a string
        const formattedResults = results.map((r) => {
            return `Title: ${r.title} URL: ${r.url}\n`;
        }).join("\n");

        return formattedResults;


    } catch (error) {
        console.error("searchWeb error:", error);
        return "[error] Failed to search web";
    }
}

async function fetchUrl(url: string): Promise<string> {
    try {
        const response = await axios.get(url, {
            responseType: "arraybuffer"
        });

        const contentType = response.headers["content-type"];

        // Handle PDF
        if (contentType?.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
            const parser = new PDFParse({
                data: response.data,
                useWorkerFetch: false,
                worker: undefined
            });
            const output = await parser.getText({ });
            return output.text || "[empty pdf]";
        }

        // Handle HTML
        // const html = response.data.toString("utf-8");
        const responseData = response.data as ArrayBuffer
        const decoder = new TextDecoder("utf-8")
        const text = decoder.decode(responseData)
        const markdownResponse = NodeHtmlMarkdown.translate(text);
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
  getBlockContentByUUID,
  searchWeb
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
    },
    {
        type: 'function',
        function: {
            name: 'searchWeb',
            description: 'Search the web for information.',
            parameters: {
                type: 'object',
                required: ['query'],
                properties: {
                    query: { type: 'string', description: 'The search query' },
                },
            },
        },
    },
]