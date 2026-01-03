import Parser from "tree-sitter";

export interface Reference {
  line: number;
  column: number;
  context: string;
}

export function findJavaScriptReferences(
  tree: Parser.Tree,
  sourceCode: string,
  symbolName: string
): Reference[] {
  const references: Reference[] = [];
  const lines = sourceCode.split("\n");

  function traverse(node: Parser.SyntaxNode) {
    // Check if this node is an identifier matching our symbol
    if (node.type === "identifier" && node.text === symbolName) {
      const startLine = node.startPosition.row;
      const startCol = node.startPosition.column;

      // Get context (the whole line)
      const context = lines[startLine] || "";

      references.push({
        line: startLine + 1, // 1-indexed for user display
        column: startCol + 1,
        context: context.trim(),
      });
    }

    // Traverse children
    for (let i = 0; i < node.childCount; i++) {
      traverse(node.child(i)!);
    }
  }

  traverse(tree.rootNode);
  return references;
}
