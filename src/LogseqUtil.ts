import { BlockEntity } from "@logseq/libs/dist/LSPlugin.user";

type DummyBlockEntity = {
    content: string;
    children: DummyBlockEntity[];
};

export class LogseqUtil {
    private static isBlockEntity(value: unknown): value is BlockEntity {
        if (!value || typeof value !== "object") {
            return false;
        }

        const maybeBlock = value as Partial<BlockEntity>;
        return typeof maybeBlock.content === "string" && Array.isArray(maybeBlock.children);
    }

    static async getBlockAndChildrenContentAsStr(block: BlockEntity, indent: string = "") {

        if (block === undefined) {
            return "";
        }

        let baseContent = indent + "- " + block.content;

        // If there is a \n in the content, add identation after the \n to have it align
        baseContent = baseContent.replace(/\n/g, "\n" + indent + "    ");

        if (block.children === undefined) {
            return baseContent;
        }

        for (const child of block.children) {

            if (child === undefined) {
                continue
            }

            let type = child[0]
            let identifier = child[1]

            if (type == "uuid") {
                const childBlock = await logseq.Editor.getBlock(identifier)
                if (childBlock) {
                    baseContent += "\n  " + await this.getBlockAndChildrenContentAsStr(childBlock, indent + "  ");
                }
            }

        }

        return baseContent;
    }

    static countIndent(line: string): number {
        let count = 0;
        for (let char of line) {
            if (char === " ") count++;
            else break;
        }
        return count;
    }

    static parseMarkdownToBlocks(markdown: string): DummyBlockEntity[] {
        const lines = markdown.split("\n");

        const root: DummyBlockEntity = { content: "__root__", children: [] };

        // Stack keeps track of hierarchy: {indentLevel, node}
        const stack: { indent: number; node: DummyBlockEntity }[] = [
            { indent: -1, node: root },
        ];

        for (let rawLine of lines) {
            if (!rawLine.trim()) continue;

            const indent = this.countIndent(rawLine);
            const trimmed = rawLine.trim();
            // const propertyMatch = /^[a-zA-Z0-9_.-]+::\s*.*$/.exec(trimmed);
            // const tableMatch = /^\|.*\|.*\|.*$/.exec(trimmed);
            const listMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
            const headingMatch = /^#{1,6}\s+(.*)$/.exec(trimmed);

            console.log(rawLine)

            if (!listMatch && !headingMatch) {
                const previousNode = stack[stack.length - 1]?.node;

                if (previousNode && previousNode !== root) {
                    previousNode.content += `\n${trimmed}`;
                    continue;
                }
            }

            let content: string;
            let effectiveIndent = indent;

            if (listMatch) {
                content = listMatch[1];
            } else {
                // Plain text = treat as top-level OR same indent logic
                content = trimmed;
                effectiveIndent = indent;
            }

            const newNode: DummyBlockEntity = {
                content,
                children: [],
            };

            // Find correct parent
            while (stack.length > 1 && stack[stack.length - 1].indent >= effectiveIndent) {
                stack.pop();
            }

            const parent = stack[stack.length - 1].node;
            parent.children.push(newNode);

            stack.push({ indent: effectiveIndent, node: newNode });
        }

        return root.children;
    }

    static async insertBlocks(baseBlock: BlockEntity, blocks: DummyBlockEntity[], root_call: boolean = false) {

        let previousBlock = baseBlock;

        for (const block of blocks) {

            let newBlock

            if (baseBlock.content?.length == 0 && previousBlock == baseBlock && root_call) {
                newBlock = baseBlock
                await logseq.Editor.updateBlock(newBlock.uuid, block.content)
                // Wait 100 ms for the update to propagate
                await new Promise(resolve => setTimeout(resolve, 500));
                baseBlock = await logseq.Editor.getBlock(baseBlock.uuid)
            } else {
                newBlock = await logseq.Editor.insertBlock(previousBlock.uuid, block.content, { before: false, sibling: true });
            }

            // Try to insert first children and then add others as siblings
            if (block.children.length > 0) {
                let firstChild = block.children[0];
                let firstChildBlock = await logseq.Editor.insertBlock(newBlock!.uuid, firstChild.content, { before: false, sibling: false });

                // Add the remaining children using this function
                await this.insertBlocks(firstChildBlock!, block.children.slice(1));
            }

            previousBlock = newBlock!

        }

    }

}