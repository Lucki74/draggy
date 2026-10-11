/** The last `size` lines of a child's stderr, kept so a crash can be logged next to its cause. Shared by
 * every engine and MCP server, so a dump looks the same wherever it comes from. */
function createRing(size = 200) {
  const lines = [];

  return {
    push(line) {
      lines.push(line);
      if (lines.length > size) lines.shift();
    },
    /** The most recent `count` lines, or all of them. */
    tail(count = size) {
      return lines.slice(-count);
    },
    dump() {
      return lines.join("\n");
    },
    get length() {
      return lines.length;
    },
  };
}

module.exports = { createRing };
