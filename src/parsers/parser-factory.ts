import Parser from "tree-sitter";
import { SupportedLanguage } from "../utils/language-detector.js";

// Import language grammars
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import Java from "tree-sitter-java";
import Go from "tree-sitter-go";
import HTML from "tree-sitter-html";
// @ts-ignore
import CSS from "tree-sitter-css";

export function createParser(language: SupportedLanguage): Parser | null {
  if (language === "unknown") {
    return null;
  }

  const parser = new Parser();

  try {
    switch (language) {
      case "javascript":
        parser.setLanguage(JavaScript as any);
        break;
      case "typescript":
        parser.setLanguage(TypeScript.typescript as any);
        break;
      case "python":
        parser.setLanguage(Python as any);
        break;
      case "java":
        parser.setLanguage(Java as any);
        break;
      case "go":
        parser.setLanguage(Go as any);
        break;
      case "html":
        parser.setLanguage(HTML as any);
        break;
      case "css":
        parser.setLanguage(CSS as any);
        break;
      default:
        return null;
    }
    return parser;
  } catch (error) {
    console.error(`Failed to create parser for ${language}:`, error);
    return null;
  }
}
