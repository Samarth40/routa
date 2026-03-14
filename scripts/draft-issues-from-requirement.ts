#!/usr/bin/env npx tsx

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { fetchGitHubIssuesViaGh } from "@/core/github/github-issue-gh";
import { syncGitHubIssuesToDirectory } from "@/core/github/github-issue-sync";

const SKILL_PATH = ".claude/skills/issue-enricher/SKILL.md";
const ISSUES_DIR = join(process.cwd(), "docs/issues");

interface CliOptions {
  text?: string;
  inputFile?: string;
  dryRun: boolean;
  skipSync: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const textIndex = argv.indexOf("--text");
  const fileIndex = argv.indexOf("--input-file");

  return {
    text: textIndex >= 0 ? argv[textIndex + 1] : undefined,
    inputFile: fileIndex >= 0 ? argv[fileIndex + 1] : undefined,
    dryRun: argv.includes("--dry-run"),
    skipSync: argv.includes("--skip-sync"),
  };
}

function readRequirement(options: CliOptions): string {
  if (options.text) {
    return options.text;
  }

  if (options.inputFile) {
    return readFileSync(options.inputFile, "utf-8");
  }

  throw new Error("Provide --text or --input-file");
}

function syncLocalIssues(skipSync: boolean): number {
  if (skipSync) {
    return 0;
  }

  const issues = fetchGitHubIssuesViaGh({ state: "all" });
  syncGitHubIssuesToDirectory(ISSUES_DIR, issues);
  return issues.length;
}

function buildPrompt(requirement: string, syncedCount: number): string {
  return `Turn the following free-form requirement into one or more GitHub issue drafts.

## Requirement
${requirement}

## Local Context
- GitHub issues have already been synced into \`docs/issues/\`${syncedCount > 0 ? ` (${syncedCount} mirrored issues)` : ""}
- Search \`docs/issues/\` first to avoid duplicates and to cite related prior work
- You MUST explicitly inspect related history before drafting. Do not skip this.

## Critical Splitting Rules
1. If the requirement contains multiple distinct product capabilities, split them into separate issue drafts.
2. Separate issues whenever the work can be implemented, tested, and tracked independently.
3. Only keep items together if they are one tightly coupled feature slice.
4. Call out related or duplicate issues from \`docs/issues/\` explicitly.

For example, treat these as separate issue candidates when they appear together:
- HARNESS DETECTOR
- Kanban AGENT
- Requirement creation AGENT

## Mandatory Analysis Rules
1. Search \`docs/issues/\` for related history before drafting.
2. Reference concrete prior issues when they exist.
3. If no relevant issue exists, write exactly: \`- None found after searching docs/issues/\`
4. Do NOT output your search process, tool usage, or intermediate thinking.
5. Output final issue drafts only.

## Output Format
Produce 1-N issue drafts using this exact structure for each one:

## Issue <n>
### Title
[clear action-oriented title]

### Problem
[1-2 paragraph problem statement]

### Why Now
- [1-3 bullets for urgency or product reason]

### Context
- Current behavior: ...
- Desired behavior: ...
- Related files/patterns: ...

### Related History
- [issue number / local docs issue file / prior implementation note]
- [or: None found after searching docs/issues/]

### Approaches
1. [approach]
   - Pros: ...
   - Cons: ...
2. [approach]
   - Pros: ...
   - Cons: ...

### Recommendation
- Recommended approach: ...
- Why: ...

### Acceptance Criteria
- [ ] ...
- [ ] ...

### Labels
- Type: ...
- Area: ...
- Complexity: ...

### Effort
[Small/Medium/Large]

### Out of Scope
- ...

If the requirement should stay as a single issue, explain why it should NOT be split.`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const requirement = readRequirement(options);
  const syncedCount = syncLocalIssues(options.skipSync);
  const prompt = buildPrompt(requirement, syncedCount);
  const skillContent = existsSync(SKILL_PATH) ? readFileSync(SKILL_PATH, "utf-8") : "";

  if (options.dryRun) {
    console.log(prompt);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required for live issue draft generation");
  }

  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const cliPath = join(process.cwd(), "node_modules/@anthropic-ai/claude-agent-sdk/cli.js");
  const stream = query({
    prompt,
    options: {
      cwd: process.cwd(),
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      maxTurns: 30,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: cliPath,
      settingSources: ["project"],
      allowedTools: ["Read", "Bash", "Glob", "Grep"],
      systemPrompt: skillContent
        ? { type: "preset", preset: "claude_code", append: skillContent }
        : undefined,
    },
  });

  for await (const msg of stream) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          process.stdout.write(block.text);
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
