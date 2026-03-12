/**
 * /api/git/branch-info - Get branch info for a repository
 *
 * GET /api/git/branch-info?repoPath=/path/to/repo
 *   Returns: { current: string, branches: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { getBranchInfo } from "@/core/git";
import * as fs from "fs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repoPath");

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing 'repoPath' query parameter" },
      { status: 400 }
    );
  }

  if (!fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Repository path does not exist" },
      { status: 404 }
    );
  }

  try {
    const branchInfo = getBranchInfo(repoPath);
    return NextResponse.json({
      current: branchInfo.current,
      branches: branchInfo.branches,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get branch info" },
      { status: 500 }
    );
  }
}

