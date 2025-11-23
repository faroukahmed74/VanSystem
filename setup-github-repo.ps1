# Script to set up GitHub repository for Van System
# Run this after creating the repository on GitHub

Write-Host "Setting up GitHub repository for Van System..." -ForegroundColor Cyan

# Check if remote already exists
$remoteExists = git remote get-url origin 2>$null
if ($remoteExists) {
    Write-Host "Remote 'origin' already exists: $remoteExists" -ForegroundColor Yellow
    $overwrite = Read-Host "Do you want to update it? (y/n)"
    if ($overwrite -eq 'y') {
        git remote remove origin
    } else {
        Write-Host "Keeping existing remote. Exiting." -ForegroundColor Yellow
        exit
    }
}

Write-Host ""
Write-Host "Please create a repository named 'van-system' on GitHub first:" -ForegroundColor Yellow
Write-Host "1. Go to https://github.com/new" -ForegroundColor White
Write-Host "2. Repository name: van-system" -ForegroundColor White
Write-Host "3. Description: RTSP stream preview and editor application" -ForegroundColor White
Write-Host "4. Choose Public or Private" -ForegroundColor White
Write-Host "5. DO NOT initialize with README, .gitignore, or license" -ForegroundColor White
Write-Host "6. Click 'Create repository'" -ForegroundColor White
Write-Host ""

$githubUsername = Read-Host "Enter your GitHub username"
$repoName = "van-system"

$remoteUrl = "https://github.com/$githubUsername/$repoName.git"

Write-Host ""
Write-Host "Adding remote: $remoteUrl" -ForegroundColor Cyan
git remote add origin $remoteUrl

Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Successfully pushed to GitHub!" -ForegroundColor Green
    Write-Host "Repository URL: https://github.com/$githubUsername/$repoName" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "❌ Push failed. Please check:" -ForegroundColor Red
    Write-Host "1. Repository exists on GitHub" -ForegroundColor Yellow
    Write-Host "2. You have access to push" -ForegroundColor Yellow
    Write-Host "3. Your GitHub credentials are configured" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You can also push manually with:" -ForegroundColor Cyan
    Write-Host "  git push -u origin main" -ForegroundColor White
}

