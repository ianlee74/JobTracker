# JobTracker — instructions for Claude

## Branch hygiene after a merge

When a pull request is merged, clean up every branch related to it without being asked:

1. `git fetch --prune`, switch to `main`, and fast-forward it.
2. Delete the local feature branch with `git branch -d`. If that refuses because the PR was
   squash-merged, confirm with `git cherry main <branch>` (every line `-`) or the PR's MERGED
   state, then `git branch -D`.
3. Delete the remote branch with `git push origin --delete <branch>` if it still exists.
   (The repo has GitHub's "Automatically delete head branches" enabled, so it usually won't.)
4. Remove any clean, detached worktree under `.claude/worktrees/` that was on that branch, then
   `git worktree prune`.

Never delete a branch whose PR is still open, or a worktree that has uncommitted changes.
