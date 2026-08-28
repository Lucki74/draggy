import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateReply,
  isMarker,
  markerPending,
  searchQuery,
  summariseResults,
} from "../voice/reply";

afterEach(() => {
  vi.unstubAllGlobals();
});

function chatStream(deltas: string[]) {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= deltas.length) {
        controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + "\n"));
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(
          JSON.stringify({ message: { content: deltas[index++] } }) + "\n",
        ),
      );
    },
  });
}

/** Each call answers with the next scripted stream of deltas. */
function installChat(passes: string[][]) {
  const bodies: Record<string, unknown>[] = [];
  let pass = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(chatStream(passes[pass++] ?? []), { status: 200 });
    }),
  );

  return bodies;
}

function run(
  passes: string[][],
  options: {
    searchEnabled?: boolean;
    search?: (query: string) => Promise<string>;
  } = {},
) {
  const bodies = installChat(passes);
  const spoken: string[] = [];
  const searched: string[] = [];

  const result = generateReply(
    {
      model: "talker",
      system: "be brief",
      turns: [{ role: "user", content: "hello" }],
      searchEnabled: options.searchEnabled ?? true,
      signal: new AbortController().signal,
      search: options.search ?? (async () => ""),
    },
    {
      onSpeech: (piece) => spoken.push(piece),
      onSearch: (query) => searched.push(query),
    },
  );

  return { result, spoken, searched, bodies };
}

describe("holding back an opening that could be a search request", () => {
  it("waits while the text is still a prefix of the marker", () => {
    expect(markerPending("")).toBe(true);
    expect(markerPending("S")).toBe(true);
    expect(markerPending("SEA")).toBe(true);
    expect(markerPending("search")).toBe(true);
  });

  it("releases as soon as it cannot be the marker", () => {
    expect(markerPending("Sea otters")).toBe(false);
    expect(markerPending("It's")).toBe(false);
    expect(markerPending("Yes.")).toBe(false);
  });

  it("releases once the probe is longer than the marker either way", () => {
    expect(markerPending("SEARCH:")).toBe(false);
    expect(markerPending("Searching")).toBe(false);
  });

  it("recognises the marker however it is spaced", () => {
    expect(isMarker("SEARCH: berlin weather")).toBe(true);
    expect(isMarker("Search : berlin")).toBe(true);
    expect(isMarker("Searching the web")).toBe(false);
  });

  it("reads the keywords off the line", () => {
    expect(searchQuery("SEARCH: berlin weather today")).toBe("berlin weather today");
    expect(searchQuery("SEARCH: berlin\nand more")).toBe("berlin");
    expect(searchQuery("SEARCH:")).toBeNull();
    expect(searchQuery("It's about four hours.")).toBeNull();
  });
});

describe("speaking an ordinary reply", () => {
  it("hands text on as it arrives once the marker is ruled out", async () => {
    const { result, spoken, searched } = run([["It's ", "about ", "four hours."]]);

    await expect(result).resolves.toEqual({
      spoken: "It's about four hours.",
      searched: null,
    });
    // The opening was released on its own chunk rather than buffered.
    expect(spoken).toEqual(["It's ", "about ", "four hours."]);
    expect(searched).toEqual([]);
  });

  it("says a reply too short to have ruled the marker out", async () => {
    const { result, spoken } = run([["Se"]]);

    await expect(result).resolves.toMatchObject({ spoken: "Se" });
    expect(spoken).toEqual(["Se"]);
  });

  it("joins the pieces it held while sniffing", async () => {
    const { result, spoken } = run([["S", "e", "arching is ", "not needed."]]);

    await expect(result).resolves.toMatchObject({
      spoken: "Searching is not needed.",
    });
    // Everything held back leaves in one piece, not character by character.
    expect(spoken[0]).toBe("Searching is ");
  });

  it("does not sniff at all when search is off", async () => {
    const search = vi.fn(async () => "");
    const { result, spoken, searched } = run([["SEARCH: berlin weather"]], {
      searchEnabled: false,
      search,
    });

    await expect(result).resolves.toMatchObject({ searched: null });
    expect(spoken).toEqual(["SEARCH: berlin weather"]);
    expect(search).not.toHaveBeenCalled();
    expect(searched).toEqual([]);
  });
});

describe("asking the web before answering", () => {
  it("runs the query and speaks only the second pass", async () => {
    const search = vi.fn(async () => "1. Berlin. Nine degrees and raining.");
    const { result, spoken, searched, bodies } = run(
      [
        ["SEARCH: ", "berlin weather", "\n"],
        ["It's ", "nine degrees and raining."],
      ],
      { search },
    );

    await expect(result).resolves.toEqual({
      spoken: "It's nine degrees and raining.",
      searched: "berlin weather",
    });

    expect(search).toHaveBeenCalledWith("berlin weather");
    expect(searched).toEqual(["berlin weather"]);
    // Not one character of the marker line reached the synthesiser.
    expect(spoken.join("")).not.toContain("SEARCH");

    const findings = bodies[1].messages as { role: string; content: string }[];
    expect(findings[findings.length - 1].content).toContain("Nine degrees");
  });

  it("takes the query even when the model never ends the line", async () => {
    const search = vi.fn(async () => "results");
    const { result } = run([["SEARCH: train times"], ["Ten past four."]], {
      search,
    });

    await expect(result).resolves.toMatchObject({ searched: "train times" });
    expect(search).toHaveBeenCalledWith("train times");
  });

  it("tells the model plainly when the web had nothing", async () => {
    const { result, bodies } = run(
      [["SEARCH: nothing at all\n"], ["I couldn't find anything."]],
      { search: async () => "" },
    );

    await result;
    const messages = bodies[1].messages as { role: string; content: string }[];
    expect(messages[messages.length - 1].content).toContain("found nothing");
  });

  it("swallows a second search request instead of looping", async () => {
    const search = vi.fn(async () => "results");
    const { result, spoken } = run(
      [
        ["SEARCH: berlin weather\n"],
        ["SEARCH: berlin weather again\n", "It's nine degrees."],
      ],
      { search },
    );

    await expect(result).resolves.toMatchObject({
      spoken: "It's nine degrees.",
      searched: "berlin weather",
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(spoken.join("")).not.toContain("SEARCH");
  });

  it("ignores an empty query rather than searching for nothing", async () => {
    const search = vi.fn(async () => "results");
    const { result } = run([["SEARCH:\n", "Sorry, I'm not sure."]], { search });

    await expect(result).resolves.toMatchObject({ searched: null });
    expect(search).not.toHaveBeenCalled();
  });
});

describe("what the model is given to answer from", () => {
  it("puts the system prompt first and the turns after it", async () => {
    const { result, bodies } = run([["Fine."]]);
    await result;

    const messages = bodies[0].messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("asks Ollama not to think out loud", async () => {
    const { result, bodies } = run([["Fine."]]);
    await result;

    expect(bodies[0].think).toBe(false);
    expect(bodies[0].stream).toBe(true);
  });

  it("numbers the results it hands over", () => {
    expect(
      summariseResults([
        { title: "One", snippet: "First." },
        { title: "Two", snippet: "Second." },
      ]),
    ).toBe("1. One. First.\n2. Two. Second.");
  });

  it("keeps only as many results as a spoken answer can use", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `T${i}`,
      snippet: "s",
    }));
    expect(summariseResults(many).split("\n")).toHaveLength(5);
  });
});
