# GitHub Actions runner pre-job gate.
#
# IMPORTANT: this file must be COPIED OUT of the repository to a path the
# runner (not the workflow) controls — e.g. C:\actions-runner\pre-job-hook.ps1
# — and referenced from the runner's .env file:
#
#   ACTIONS_RUNNER_HOOK_JOB_STARTED=C:\actions-runner\pre-job-hook.ps1
#
# It runs before ANY step of ANY job, before code is checked out. If it exits
# non-zero the job fails immediately, so a malicious workflow (e.g. from a
# fork PR on this public repo) never executes on this machine. Do not point
# the .env at the copy inside a checkout directory — that copy is
# attacker-writable.
#
# The repo copy exists only so the gate is versioned and reviewable; after
# changing it, re-copy it to the runner manually.

$ErrorActionPreference = 'Stop'

$allowedRepo   = 'ianlee74/JobTracker'
$allowedEvents = @('push', 'workflow_dispatch')
$allowedRef    = 'refs/heads/main'
$allowedActors = @('ianlee74')

function Deny([string]$why) {
    Write-Host "::error::Pre-job gate refused this job: $why"
    Write-Host "repository=$env:GITHUB_REPOSITORY event=$env:GITHUB_EVENT_NAME ref=$env:GITHUB_REF actor=$env:GITHUB_ACTOR"
    exit 1
}

if ($env:GITHUB_REPOSITORY -ne $allowedRepo) {
    Deny "repository '$env:GITHUB_REPOSITORY' is not '$allowedRepo' (fork?)"
}
if ($allowedEvents -notcontains $env:GITHUB_EVENT_NAME) {
    Deny "event '$env:GITHUB_EVENT_NAME' is not one of: $($allowedEvents -join ', ')"
}
if ($env:GITHUB_REF -ne $allowedRef) {
    Deny "ref '$env:GITHUB_REF' is not '$allowedRef'"
}
if ($allowedActors -notcontains $env:GITHUB_ACTOR) {
    Deny "actor '$env:GITHUB_ACTOR' is not allowed"
}

Write-Host "Pre-job gate: OK ($env:GITHUB_EVENT_NAME on $env:GITHUB_REF by $env:GITHUB_ACTOR)"
exit 0
