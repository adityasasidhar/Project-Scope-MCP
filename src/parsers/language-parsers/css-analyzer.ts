import Parser from "tree-sitter";
import { Reference } from "./javascript-analyzer.js";

export function findCSSReferences(
  tree: Parser.Tree,
  sourceCode: string,
  symbolName: string
): Reference[] {
  const references: Reference[] = [];
  const lines = sourceCode.split("\n");

  function traverse(node: Parser.SyntaxNode) {
    // Look for class selectors, ID selectors, and custom properties
    if (
      (node.type === "class_name" ||
        node.type === "id_name" ||
        node.type === "property_name") &&
      node.text.includes(symbolName)
    ) {
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
