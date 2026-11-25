import { describe, expect, it } from "vitest";
import {
  commandCovered,
  commandGrantTargets,
  commandPrefix,
  commandSegments,
  dialectFor,
  type ShellDialect,
} from "../agent/commandRules";

/** Lines a grant for the first command must never cover, and lines it must keep covering. */

const MUST_ASK: Array<[ShellDialect, string, string]> = [
  ["bash", "ls", "ls > out.txt"],
  ["bash", "ls", "ls >> out.txt"],
  ["bash", "ls", "ls 2> errors.log"],
  ["bash", "ls", "ls && rm -rf build"],
  ["bash", "ls", "ls; rm file"],
  ["bash", "ls", "ls | xargs rm"],
  ["bash", "ls", "ls & rm file"],
  ["bash", "ls", "ls\nrm file"],
  ["bash", "echo", "echo $(cat .env)"],
  ["bash", "echo", "echo `cat .env`"],
  ["bash", "echo", "echo <(cat .env)"],
  ["bash", "echo", "echo ${SECRET}"],
  ["bash", "echo", "(echo hi; rm file)"],
  ["bash", "echo", "{ echo hi; rm file; }"],
  ["bash", "cat", "cat <<EOF\nhello\nEOF"],
  ["bash", "echo", 'echo "unfinished'],
  ["bash", "echo", "echo trailing \\"],
  ["bash", "ls", "$CMD file"],
  ["bash", "ls", ". ./setup.sh"],
  ["bash", "ls", "ls $(echo; rm file)"],
  ["bash", "git", "bash -c 'git status'"],
  ["bash", "git status", "git -C elsewhere stash"],
  ["bash", "git status", "git -c core.pager=evil status; rm file"],
  ["bash", "ls", "ls 2>/dev/null > out.txt"],
  ["bash", "node", "eval node"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem > out.txt"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem 2>/dev/null"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem; Remove-Item x"],
  ["pwsh", "Write-Output", "Write-Output (Remove-Item x)"],
  ["pwsh", "Write-Output", "Write-Output @(Remove-Item x)"],
  ["pwsh", "Write-Output", "Write-Output @{ a = 1 }"],
  ["pwsh", "Write-Output", "Write-Output $(Remove-Item x)"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem | ForEach-Object { Remove-Item $_ }"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem <# hidden #> ; Remove-Item x"],
  ["pwsh", "git", "git --% status"],
  ["pwsh", "Get-ChildItem", "& Remove-Item x"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem & Remove-Item x"],
  ["pwsh", "Get-ChildItem", ". .\\setup.ps1"],
  ["pwsh", "Get-ChildItem", "$cmd x"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem `\nRemove-Item x"],
  ["pwsh", "Invoke-Command", "Invoke-Command -ScriptBlock { 1 }"],
  ["pwsh", "Start-Job", "Start-Job -ScriptBlock { 1 }"],
  ["cmd", "dir", "dir > out.txt"],
  ["cmd", "dir", "dir & del file"],
  ["cmd", "dir", "dir %COMSPEC%"],
  ["cmd", "dir", "dir ^& del file"],
  ["cmd", "dir", "dir && del file"],
];

const MUST_ALLOW: Array<[ShellDialect, string, string]> = [
  ["bash", "ls", "ls -la"],
  ["bash", "npm test", "npm test --coverage"],
  ["bash", "git status", "git status 2>&1"],
  ["bash", "git fetch", "git fetch 2>/dev/null"],
  ["bash", "git fetch", "git fetch &>/dev/null"],
  ["bash", "git log", "git log --oneline -n 5"],
  ["bash", "git push", "git -C dir push origin main"],
  ["bash", "echo", 'echo "a && b; c | d"'],
  ["bash", "echo", "echo 'it is ; fine'"],
  ["bash", "echo", 'echo "say \\"hi\\" ; there"'],
  ["bash", "echo", "echo a\\;b"],
  ["bash", "npm run build", "npm run build"],
  ["bash", "python", "python -c \"print(1)\""],
  ["bash", "git commit", "git commit -m \"fix (parser)\""],
  ["pwsh", "Write-Output", "Write-Output 'a (b)'"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem -Recurse"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem 2>$null"],
  ["pwsh", "Get-ChildItem", "Get-ChildItem *>$null"],
  ["pwsh", "Get-Content", "Get-Content 'a; b'"],
  ["pwsh", "git status", "git status && git status -s"],
  ["cmd", "dir", "dir /b"],
  ["cmd", "dir", "dir 2>nul"],
];

describe("command rules: lines that must ask", () => {
  it.each(MUST_ASK)("%s: a grant for %j does not cover %j", (dialect, grant, line) => {
    // The corpus is only meaningful if each line is refused for being unreadable or uncovered.
    const grants = [grant];
    expect(commandCovered(grants, line, dialect)).toBe(false);
  });

  it("unreadable lines leave nothing to remember", () => {
    for (const [dialect, , line] of MUST_ASK) {
      if (commandSegments(line, dialect) === null) expect(commandGrantTargets(line, dialect)).toEqual([]);
    }
  });
});

describe("command rules: lines that stay allowed", () => {
  it.each(MUST_ALLOW)("%s: a grant for %j covers %j", (dialect, grant, line) => {
    expect(commandCovered([grant], line, dialect)).toBe(true);
  });
});

describe("command rules: prefixes", () => {
  it("skips global git options before the subcommand", () => {
    expect(commandPrefix("git -C dir push --force")).toBe("git push");
    expect(commandPrefix("git -c user.name=x commit -m hi")).toBe("git commit");
    expect(commandPrefix("git --no-pager log")).toBe("git log");
    expect(commandPrefix("git --git-dir=.git status")).toBe("git status");
  });

  it("never turns a bare git into a grant for every subcommand", () => {
    expect(commandPrefix("git -C dir")).toBe("git -C dir");
  });

  it("names the whole command for interpreters and launchers", () => {
    expect(commandPrefix("xargs rm file")).toBe("xargs rm file");
    expect(commandPrefix("Start-Process notepad")).toBe("Start-Process notepad");
    expect(commandPrefix("eval ls")).toBe("eval ls");
    expect(commandGrantTargets("python -c 'import os'", "bash")).toEqual(["python -c 'import os'"]);
    expect(commandGrantTargets("iex 'Remove-Item x'", "pwsh")).toEqual(["iex 'Remove-Item x'"]);
  });
});

describe("command rules: dialects", () => {
  it("maps shell names to their grammar", () => {
    expect(dialectFor("bash")).toBe("bash");
    expect(dialectFor("sh")).toBe("bash");
    expect(dialectFor("pwsh")).toBe("pwsh");
    expect(dialectFor("powershell")).toBe("pwsh");
    expect(dialectFor("cmd")).toBe("cmd");
    expect(dialectFor(undefined)).toBe("pwsh");
  });

  it("treats /dev/null as a sink only in bash and $null only in PowerShell", () => {
    expect(commandSegments("ls 2>/dev/null", "bash")).toEqual(["ls"]);
    expect(commandSegments("ls 2>/dev/null", "pwsh")).toBeNull();
    expect(commandSegments("ls 2>$null", "pwsh")).toEqual(["ls"]);
    expect(commandSegments("ls 2>$null", "bash")).toBeNull();
  });
});
