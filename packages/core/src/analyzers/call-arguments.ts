const closingFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const maxCallLength = 2000;

/**
 * Splits the arguments of the call whose "(" is at openParenIndex.
 *
 * Returns the trimmed top-level arguments, or undefined when the call is not
 * closed within 2000 characters. Commas inside brackets, braces, string
 * literals, and template literals (including ${...}) do not split arguments.
 */
export function splitCallArguments(
  content: string,
  openParenIndex: number,
): string[] | undefined {
  if (content[openParenIndex] !== "(") {
    return undefined;
  }

  const end = Math.min(content.length, openParenIndex + maxCallLength);
  // Each entry is the character that closes the current nesting level;
  // "`" marks a template literal whose ${...} expressions nest further.
  const stack: string[] = [")"];
  const args: string[] = [];
  let current = "";

  for (let index = openParenIndex + 1; index < end; index += 1) {
    const char = content[index] ?? "";
    const top = stack.at(-1);

    if (top === "`") {
      current += char;
      if (char === "\\") {
        current += content[index + 1] ?? "";
        index += 1;
      } else if (char === "`") {
        stack.pop();
      } else if (char === "$" && content[index + 1] === "{") {
        current += "{";
        index += 1;
        stack.push("}");
      }
      continue;
    }

    if (char === '"' || char === "'") {
      const close = findStringEnd(content, index, char, end);
      if (close === undefined) {
        return undefined;
      }
      current += content.slice(index, close + 1);
      index = close;
      continue;
    }

    if (char === "`") {
      current += char;
      stack.push("`");
      continue;
    }

    const closing = closingFor[char];
    if (closing !== undefined) {
      stack.push(closing);
      current += char;
      continue;
    }

    if (char === top) {
      stack.pop();
      if (stack.length === 0) {
        if (current.trim().length > 0 || args.length > 0) {
          args.push(current.trim());
        }
        return args;
      }
      current += char;
      continue;
    }

    if (char === "," && stack.length === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  return undefined;
}

function findStringEnd(
  content: string,
  start: number,
  quote: string,
  end: number,
): number | undefined {
  for (let index = start + 1; index < end; index += 1) {
    const char = content[index];
    if (char === "\\") {
      index += 1;
    } else if (char === quote) {
      return index;
    } else if (char === "\n") {
      return undefined;
    }
  }
  return undefined;
}
