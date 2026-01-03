import Parser from "tree-sitter";
import { Reference } from "./javascript-analyzer.js";

export function findTypeScriptReferences(
  tree: Parser.Tree,
  sourceCode: string,
  symbolName: string
): Reference[] {
  const references: Reference[] = [];
  const lines = sourceCode.split("\n");

  function traverse(node: Parser.SyntaxNode) {
    // TypeScript identifiers work similarly to JavaScript
    if (node.type === "identifier" && node.text === symbolName) {
      const startLine = node.startPosition.row;
      const startCol = node.startPosition.column;

      const context = lines[startLine] || "";

      references.push({
        line: startLine + 1,
        column: startCol + 1,
        context: context.trim(),
      });
    }

    for (let i = 0; i < node.childCount; i++) {
      traverse(node.child(i)!);
    }
  }

  traverse(tree.rootNode);
  return references;
}
